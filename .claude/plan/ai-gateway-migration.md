# 📋 實施計劃：AI Gateway 遷移（OpenClaw → ZeroClaw）

## 任務類型
- [x] 後端 (→ Codex)
- [ ] 前端（無 UI 變更，Settings 頁面保持現狀）

## 技術方案

建立 `src/lib/ai-gateway/` 模組作為 provider-agnostic 抽象層，取代直接耦合 OpenClaw 的 `src/lib/openclaw/client.ts`。ZeroClaw 為預設閘道，OpenClaw 透過環境變數或租戶配置啟用。

**關鍵差異：兩者 API 完全不同**

| | OpenClaw | ZeroClaw |
|---|---------|----------|
| **協議** | REST (OpenAI-compatible) | REST (`/webhook`) + WebSocket (`/ws/chat`) |
| **Chat 端點** | `POST /v1/chat/completions` | `POST /webhook` |
| **請求格式** | `{model, messages[], stream}` | `{"message": "prompt"}` |
| **回應格式** | `{choices[{message}], usage}` | `{"response": "text", "model": "name"}` |
| **認證** | `Bearer token` + `x-tenant-id` | `Bearer token` (from `/pair`) |
| **System prompt** | 在 messages 陣列中注入 | 由 ZeroClaw 內部 config 管理 |
| **多輪對話** | Client 管理 history | WebSocket 維護 session（webhook 為 stateless） |
| **Port** | 18789 | 42617 |

ChainThings 使用同步 request-response，因此對接 ZeroClaw 的 `POST /webhook` 端點。

**核心設計**：client 層負責 request/response 格式轉換，對 API routes 暴露統一的 `ChatCompletionResponse` 介面。

## 實施步驟

### Step 1：新增 `src/lib/ai-gateway/providers.ts` — Provider 註冊表

```typescript
export type AiProvider = "zeroclaw" | "openclaw";

export interface ProviderConfig {
  name: AiProvider;
  baseUrl: string;
  defaultToken?: string;
  defaultModel: string;
  timeoutMs: number;
  // Provider-specific API details
  chatEndpoint: string;        // "/webhook" or "/v1/chat/completions"
  requestFormat: "zeroclaw" | "openai";
  supportsTenantHeader: boolean;
  tenantHeaderName?: string;   // "x-tenant-id" for openclaw
}

// ZeroClaw config:
//   chatEndpoint: "/webhook"
//   requestFormat: "zeroclaw"
//   supportsTenantHeader: false
//
// OpenClaw config:
//   chatEndpoint: "/v1/chat/completions"
//   requestFormat: "openai"
//   supportsTenantHeader: true
//   tenantHeaderName: "x-tenant-id"

// Env vars:
// ZEROCLAW_GATEWAY_URL (default: http://localhost:42617)
// ZEROCLAW_GATEWAY_TOKEN
// ZEROCLAW_TIMEOUT_MS (default: 30000)
// OPENCLAW_GATEWAY_URL, OPENCLAW_GATEWAY_TOKEN, OPENCLAW_TIMEOUT_MS
// DEFAULT_AI_PROVIDER (default: "zeroclaw")

export function getDefaultProvider(): AiProvider;
export function getProviderConfig(provider: AiProvider): ProviderConfig;
```

### Step 2：新增 `src/lib/ai-gateway/client.ts` — 格式轉換 Client

```typescript
// 統一的輸入/輸出介面（與現有 OpenClaw client 相容）
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatCompletionOptions {
  provider?: AiProvider;
  token?: string;
  tenantId?: string;
  model?: string;
  systemPrompt?: string;
  requireTenantToken?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  provider: AiProvider;
  choices: {
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function chatCompletion(
  messages: ChatMessage[],
  userId?: string,
  options?: ChatCompletionOptions
): Promise<ChatCompletionResponse> {
  const provider = options?.provider ?? getDefaultProvider();
  const config = getProviderConfig(provider);
  const token = options?.token || config.defaultToken;

  // Build request based on provider format
  let url: string;
  let body: string;

  if (config.requestFormat === "zeroclaw") {
    // ZeroClaw: POST /webhook
    // Flatten messages into single prompt string
    // System prompts + history → concatenated message
    url = `${config.baseUrl}${config.chatEndpoint}`;
    const prompt = buildZeroClawPrompt(messages);
    body = JSON.stringify({ message: prompt });
  } else {
    // OpenClaw: POST /v1/chat/completions (OpenAI format)
    url = `${config.baseUrl}${config.chatEndpoint}`;
    body = JSON.stringify({
      model: options?.model || config.defaultModel,
      messages,
      stream: false,
      ...(userId && { user: userId }),
    });
  }

  // Execute with AbortController timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    if (config.supportsTenantHeader && options?.tenantId && config.tenantHeaderName) {
      headers[config.tenantHeaderName] = options.tenantId;
    }

    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${provider} error ${res.status}: ${text}`);
    }

    // Normalize response to ChatCompletionResponse
    if (config.requestFormat === "zeroclaw") {
      const data = await res.json();
      // ZeroClaw returns: {"response": "text", "model": "name"}
      return {
        id: `zc-${Date.now()}`,
        provider: "zeroclaw",
        choices: [{
          index: 0,
          message: { role: "assistant", content: data.response },
          finish_reason: "stop",
        }],
      };
    } else {
      const data = await res.json();
      return { ...data, provider: "openclaw" };
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`${provider} request timed out after ${config.timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Helper: flatten ChatMessage[] into single ZeroClaw prompt
function buildZeroClawPrompt(messages: ChatMessage[]): string {
  // Strategy: concatenate system prompts as context prefix,
  // then format user/assistant history, ending with latest user message
  //
  // Example output:
  //   "[System] You are a helpful assistant.\n\n"
  //   "User: Hello\n"
  //   "Assistant: Hi there!\n"
  //   "User: What is 2+2?"
  //
  // For single-turn (most common in ChainThings):
  //   just return the user message content with system prompt prepended

  const systemParts = messages.filter(m => m.role === "system").map(m => m.content);
  const nonSystem = messages.filter(m => m.role !== "system");

  const parts: string[] = [];
  if (systemParts.length > 0) {
    parts.push(systemParts.join("\n\n"));
  }

  if (nonSystem.length === 1 && nonSystem[0].role === "user") {
    // Single user message — append directly
    parts.push(nonSystem[0].content);
  } else {
    // Multi-turn: format as dialogue
    for (const msg of nonSystem) {
      const label = msg.role === "user" ? "User" : "Assistant";
      parts.push(`${label}: ${msg.content}`);
    }
  }

  return parts.join("\n\n");
}
```

### Step 3：新增 `src/lib/ai-gateway/index.ts` — 公開 API

```typescript
export { chatCompletion, type ChatMessage, type ChatCompletionOptions, type ChatCompletionResponse } from "./client";
export { type AiProvider, getDefaultProvider, getProviderConfig } from "./providers";
```

### Step 4：更新 API Routes

**`src/app/api/chat/route.ts`**：
- 改 import 為 `@/lib/ai-gateway`
- 租戶配置查詢改為 `.in("service", ["zeroclaw", "openclaw"])`
- 優先使用 zeroclaw 配置，fallback 到 openclaw
- **注意**：ZeroClaw 的 `/webhook` 是 stateless，多輪對話 history 由 client 拼接到 prompt

**`src/app/api/workflows/generate/route.ts`**：
- 同上邏輯（此 route 本就是 single-turn，更簡單）

```typescript
// 租戶 provider 解析（兩個 route 共用）：
const { data: aiIntegrations } = await supabase
  .from("chainthings_integrations")
  .select("service, config")
  .eq("tenant_id", profile.tenant_id)
  .in("service", ["zeroclaw", "openclaw"]);

const zcConfig = aiIntegrations?.find(i => i.service === "zeroclaw");
const ocConfig = aiIntegrations?.find(i => i.service === "openclaw");
const activeConfig = zcConfig || ocConfig;

const options: ChatCompletionOptions = {
  provider: zcConfig ? "zeroclaw" : ocConfig ? "openclaw" : undefined,
  token: (activeConfig?.config as any)?.api_token || undefined,
  tenantId: profile.tenant_id,
};
```

### Step 5：保留舊路徑相容

**`src/lib/openclaw/client.ts`**：改為 re-export wrapper

```typescript
// Deprecated: use @/lib/ai-gateway instead
export { chatCompletion, type ChatCompletionOptions } from "@/lib/ai-gateway";
```

### Step 6：更新測試基礎設施

**`src/__tests__/setup.ts`**：
- 新增 `ZEROCLAW_GATEWAY_URL`, `ZEROCLAW_GATEWAY_TOKEN` env vars
- 新增 `vi.mock("@/lib/ai-gateway")`
- 保留 `vi.mock("@/lib/openclaw/client")` 指向新 re-export

**`src/lib/ai-gateway/client.test.ts`**（新增）：
- 測試 ZeroClaw format: messages → single prompt → `{"message": "..."}`
- 測試 ZeroClaw response normalization: `{"response": "..."}` → `ChatCompletionResponse`
- 測試 OpenClaw format: passthrough OpenAI format
- 測試 `buildZeroClawPrompt()` — system + single user, system + multi-turn
- 測試 provider 切換、timeout、error handling
- 測試 tenant header 條件邏輯（openclaw 有、zeroclaw 無）

**`src/lib/ai-gateway/providers.test.ts`**（新增）：
- 測試 env var 解析
- 測試 getDefaultProvider() fallback
- 測試 provider config 差異（chatEndpoint, requestFormat）

### Step 7：更新環境變數

**`.env.example`**：
```env
# === AI Gateway ===
# Default: zeroclaw. Set to "openclaw" to use OpenClaw instead
# DEFAULT_AI_PROVIDER=zeroclaw
ZEROCLAW_GATEWAY_URL=http://localhost:42617
ZEROCLAW_GATEWAY_TOKEN=
# ZEROCLAW_TIMEOUT_MS=30000

# === OpenClaw (legacy, optional) ===
# OPENCLAW_GATEWAY_URL=http://localhost:18789
# OPENCLAW_GATEWAY_TOKEN=
# OPENCLAW_MODEL=openclaw:main
# OPENCLAW_TIMEOUT_MS=30000
```

**`docker-compose.yml`**：新增 ZEROCLAW_* 環境變數

**`.env.local`**：新增 ZeroClaw 實際設定

## 關鍵文件

| 文件 | 操作 | 說明 |
|------|------|------|
| `src/lib/ai-gateway/providers.ts` | 新增 | Provider 註冊表 + chatEndpoint/requestFormat |
| `src/lib/ai-gateway/client.ts` | 新增 | 格式轉換 client + buildZeroClawPrompt |
| `src/lib/ai-gateway/index.ts` | 新增 | 公開 API re-export |
| `src/lib/openclaw/client.ts` | 修改 | 改為 deprecated re-export |
| `src/app/api/chat/route.ts` | 修改 | 改用 ai-gateway + 多 provider 查詢 |
| `src/app/api/workflows/generate/route.ts` | 修改 | 同上 |
| `src/__tests__/setup.ts` | 修改 | 新增 ai-gateway mock + env vars |
| `src/lib/ai-gateway/client.test.ts` | 新增 | 格式轉換 + provider 切換測試 |
| `src/lib/ai-gateway/providers.test.ts` | 新增 | Provider 解析測試 |
| `src/lib/openclaw/client.test.ts` | 修改 | 更新為測試 re-export |
| `.env.example` | 修改 | 新增 ZEROCLAW_* + DEFAULT_AI_PROVIDER |
| `docker-compose.yml` | 修改 | 新增 ZEROCLAW 環境變數 |
| `CLAUDE.md` | 修改 | 更新架構說明 |

## 風險與緩解

| 風險 | 緩解措施 |
|------|----------|
| ZeroClaw `/webhook` 不支援多輪對話 state | `buildZeroClawPrompt()` 將 history 拼接為單一 prompt |
| ZeroClaw 沒有 usage/token 統計回傳 | Response 的 `usage` 欄位設為 undefined，不影響功能 |
| System prompt 處理方式不同 | ZeroClaw: prepend 到 prompt；OpenClaw: messages[0] 注入 |
| ZeroClaw `/webhook` 無 model 選擇參數 | 使用 ZeroClaw 內部 config 的模型設定，ChainThings 側不需指定 |
| 現有租戶 OpenClaw 配置失效 | 查詢 `in("service", ["zeroclaw", "openclaw"])`，openclaw 配置繼續生效 |
| import 路徑變更導致遺漏 | `src/lib/openclaw/client.ts` 保留為 re-export |

## 不在範圍內

- Settings 頁面 UI 變更（provider 透過 env var 或 DB 配置切換）
- 資料庫遷移（integrations 表已支援任意 service name）
- n8n 工作流變更（不涉及 AI gateway）
- WebSocket streaming 支援（未來可加，目前用 `/webhook` 同步模式）

## ZeroClaw API Reference

- Repo: https://github.com/zeroclaw-labs/zeroclaw
- Chat: `POST /webhook` — `{"message": "prompt"}` → `{"response": "text", "model": "name"}`
- Auth: `Authorization: Bearer <token>` (obtained via `POST /pair`)
- Health: `GET /health`
- Port: 42617

## SESSION_ID（供 /ccg:execute 使用）
- CODEX_SESSION: 019cf5b7-e131-7c42-b525-a036305a0fbf
- GEMINI_SESSION: e77ab8e4-f604-4f54-b231-aeb4f55601ca
