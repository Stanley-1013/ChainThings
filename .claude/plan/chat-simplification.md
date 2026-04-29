# 實施計劃：Chat API 簡化 + ZeroClaw 原生整合

**規劃時間**：2026-03-25
**預估工作量**：8 任務點
**原則**：不過度工程，最小改動最大改善

---

## 1. 研究發現

### ZeroClaw 實測結果

| 特性 | 狀態 | 細節 |
|------|------|------|
| `/webhook` | ✅ | `{ message, context?, history? }` → `{ model, response }` |
| `context` 參數 | ✅ | 可注入 system prompt |
| `history` 參數 | ✅ | 支援 `[{role, content}]` 多輪對話 |
| OpenAI 相容 API | ❌ | `/v1/chat/completions` 回 405 |
| Streaming | ❌ | `stream:true` timeout |
| Session 持久化 | ❌ | `session_id` 不保持記憶 |
| Tool call 自動執行 | ❌ | 回傳 `<tool_call>` XML 但 webhook 模式不執行 |
| 原生模型 | MiniMax-M2.7 | 120s timeout, fallback gpt-5.4 |

### 核心問題
1. SSE streaming 是假的（ZeroClaw 不支援 streaming）→ 移除 SSE，改回 JSON
2. System prompt 過載（RAG + memory + deadlines 全塞進去）→ 精簡
3. RAG 對每條訊息都跑 → 只在有檢索意圖時跑
4. Memory injection 把記憶塞進 prompt → 移除（讓 ZeroClaw 自己用 memory_recall）
5. Flat message 丟失上下文 → 改用 `context` + `history` 參數

---

## 2. 實施方案

### 改動 1：使用 ZeroClaw 原生 `context` + `history` 參數（取代 flat prompt）

**文件**：`src/lib/ai-gateway/client.ts`

目前 `buildZeroClawPrompt()` 把所有 system/user/assistant messages 拼成一個字串。改為：
- `message` = 最新一條 user message
- `context` = 所有 system prompts 合併
- `history` = 之前的 user/assistant messages

**好處**：ZeroClaw 可以正確理解對話結構，不再把 system prompt 當成對話內容。

### 改動 2：移除 SSE，回歸 JSON 模式

**文件**：`src/app/api/chat/route.ts`, `src/app/(protected)/chat/[conversationId]/page.tsx`

ZeroClaw 不支援 streaming。現有 SSE 只是包裝：等完整回應 → 推送 delta → done。
實際體驗跟 JSON fetch 完全一樣，但多了 SSE 的複雜度。

- 後端 + 前端**同一個 commit 一起改**（無其他 client 依賴此 API）
- 後端：移除 SSE 分支，統一用 JSON
- 前端：回歸 `fetch` + `res.json()`，移除 `stream-client.ts` 依賴
- 保留 loading 狀態但簡化為「正在思考...」（不分 searching/thinking）

### 改動 3：精簡 RAG 觸發條件

**文件**：`src/app/api/chat/route.ts`

> **⚠️ 審查修正**：原計劃用 keyword-only 觸發太嚴格，會漏掉「那昨天的結論呢？」這類跟進問題。改為「skip obvious chatter」策略。

目前 `shouldRunRag()` 對幾乎所有非 greeting 訊息都觸發 RAG（3-5s 延遲）。改為：
- 保持現有的 greeting/short message 過濾（已有）
- 額外跳過**純閒聊**模式：短英文句子（≤3 words，無問號/數字）
- 不改為 keyword-only（會漏掉正常跟進問題）
- 本質上維持現有邏輯，不做大改

### 改動 4：移除 Memory injection 到 prompt

**文件**：`src/app/api/chat/route.ts`

目前 `runRag()` 把 memory_entries 和 deadlines 塞進 system prompt，佔用 token budget 且可能干擾 AI 思考。

- 移除 memory injection（`MAX_MEMORIES` 查詢）
- 保留 deadline injection（有明確產品價值）
- 未來：ZeroClaw 可以透過 tool 自己 recall memory

### 改動 5：前端簡化

**文件**：`src/app/(protected)/chat/[conversationId]/page.tsx`

- `sendMessage` 回歸 `fetch` + `res.json()`
- 移除 SSE streaming 相關狀態（`streamingPhase`, `streamingContentRef`, `updateTimerRef`）
- 保留 scroll 防衝突 + n8n badge 改進

---

## 3. 不改的部分

- ✅ RAG embedding 自動觸發（`after()` + `triggerEmbedding`）— 保留
- ✅ Per-tenant webhook secret — 保留
- ✅ Workflow error transparency — 保留
- ✅ Memory extraction via `after()` — 保留
- ✅ Notification system — 保留（已修復 JSON parse bug）
- ✅ n8n editor URL fallback — 保留

---

## 4. 關鍵文件

| 文件 | 操作 | 說明 |
|------|------|------|
| `src/lib/ai-gateway/client.ts` | 修改 | buildZeroClawPayload: message + context + history |
| `src/app/api/chat/route.ts` | 修改 | 移除 SSE，精簡 RAG，移除 memory injection |
| `src/app/(protected)/chat/[conversationId]/page.tsx` | 修改 | 回歸 fetch JSON，簡化狀態 |

---

## 5. 風險

| 風險 | 緩解 |
|------|------|
| 移除 SSE 後前端需改動 | 改動量不大，回歸 fetch 更簡單 |
| 移除 memory injection 降低回答品質 | RAG 搜尋仍在，deadline 仍注入，memory 可後續透過 tool 回來 |
| ZeroClaw history 參數行為未完全確認 | 已實測確認 history 參數可正確接收 |

---

## 6. SESSION_ID

- CODEX_SESSION: 019d200f-170a-7712-b46c-280d216513f4
