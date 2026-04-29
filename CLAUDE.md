# ChainThings

## 專案願景

ChainThings 是一個多租戶 Next.js 應用，整合 Supabase（認證、資料庫、儲存、向量搜索）、AI 閘道（ZeroClaw 或 OpenClaw）、以及 n8n（工作流自動化）。它為每個租戶提供隔離的聊天（含 RAG 檢索增強）、檔案管理、工作流產生、會議記錄管理、助手記憶、AI 通知摘要和第三方整合（如 Hedy.ai）能力。

## 架構總覽

- **框架**: Next.js 16 (App Router, React 19, TypeScript 5, Tailwind CSS 4)
- **認證與資料**: Supabase（Auth + PostgreSQL + Storage + pgvector），透過 RLS 實現多租戶行級隔離
- **RAG**: pgvector 向量搜索 + 全文搜索 + RRF 混合排名，聊天時自動檢索相關會議記錄和記憶
- **AI 閘道**: ZeroClaw（預設，`POST /webhook`）或 OpenClaw（legacy，OpenAI 相容 API），透過 `src/lib/ai-gateway/` 抽象層支援 provider 切換，每租戶可獨立配置 token 與系統提示詞
- **工作流引擎**: n8n，透過 REST API 建立/啟用工作流，使用節點類型白名單限制 AI 產生的工作流
- **部署**: Docker (standalone Next.js) + docker-compose，連接外部 `lab_net` 網路中的 Supabase、n8n、ZeroClaw/OpenClaw 容器
- **多租戶模型**: 每個使用者註冊時自動產生 `tenant_id`（UUID），所有業務表透過 `tenant_id` + RLS 策略隔離

```
Request -> Middleware (auth check) -> App Router
                                        |
                 +----------------------+----------------------+
                 |                      |                      |
           (auth) pages          (protected) pages        API Routes
           /login, /register     /dashboard, /chat,       /api/chat
           /callback             /files, /workflows,      /api/files/upload
                                 /items, /items/new,      /api/workflows/generate
                                 /settings                /api/integrations
                                                          /api/integrations/hedy/setup
                                                          /api/items + /api/items/[id]
                                                          /api/items/extract
                                                          /api/memory
                                                          /api/notifications
                                                          /api/notifications/settings
                                                          /api/notifications/generate
                                                          /api/rag/embed
                                                          /api/webhooks/hedy/[tenantId]
                                                          /api/auth/signout
                 |                      |                      |
                 +----------------------+----------------------+
                                        |
                            Supabase (DB + Auth + Storage + pgvector)
                            ZeroClaw/OpenClaw (AI chat + embeddings)
                            n8n (workflow automation)
```

## 模組結構圖

本專案為單體 Next.js 應用，無獨立子模組/套件。按功能域劃分如下：

```mermaid
graph TD
    A["ChainThings (根)"] --> B["src/app — 頁面與 API 路由"]
    A --> C["src/lib — 共享函式庫/客戶端"]
    A --> D["supabase/migrations — 資料庫遷移"]

    B --> B1["(auth) — 登入/註冊/回呼"]
    B --> B2["(protected) — 受保護頁面"]
    B --> B3["api/ — 後端 API 路由"]

    B2 --> B2a["dashboard"]
    B2 --> B2b["chat"]
    B2 --> B2c["files"]
    B2 --> B2d["workflows"]
    B2 --> B2e["settings"]

    B3 --> B3a["chat"]
    B3 --> B3b["files/upload"]
    B3 --> B3c["workflows/generate"]
    B3 --> B3d["integrations"]
    B3 --> B3e["integrations/hedy/setup"]
    B3 --> B3f["items + items/[id] + items/extract"]
    B3 --> B3g["memory"]
    B3 --> B3h["notifications + notifications/settings + notifications/generate"]
    B3 --> B3i["rag/embed"]
    B3 --> B3j["webhooks/hedy/[tenantId]"]
    B3 --> B3k["auth/signout"]

    C --> C1["supabase/ — 客戶端封裝"]
    C --> C2["ai-gateway/ — AI 閘道抽象（chat + embeddings）"]
    C --> C3["rag/ — RAG 管線（分塊、搜索、嵌入 worker）"]
    C --> C4["n8n/ — 工作流 API 客戶端 + 節點驗證"]
    C --> C5["openclaw/ — Deprecated re-export"]
```

## 模組索引

| 功能域 | 路徑 | 說明 |
|--------|------|------|
| 認證 | `src/app/(auth)/` | 登入、註冊、OAuth 回呼、忘記密碼、重設密碼 |
| 受保護頁面 | `src/app/(protected)/` | Dashboard（含通知面板 + Task Center）、Chat（含 RAG）、Files、Workflows、Items（列表 + 新增 + 詳情）、Settings |
| API 路由 | `src/app/api/` | 聊天（RAG 增強）、對話 CRUD、Profile、檔案上傳、工作流產生、整合管理、Hedy backfill/check/setup、Items + extract、Memory CRUD、Notifications + settings + generate、RAG embed、Dev Services（projects + actions + worker + OAuth + webhooks）|
| Supabase 封裝 | `src/lib/supabase/` | 瀏覽器客戶端、伺服器端客戶端、admin 客戶端、cookie 名常數 |
| AI 閘道 | `src/lib/ai-gateway/` | Provider-agnostic AI client（chat + embeddings），支援 ZeroClaw + OpenClaw |
| Chat 客戶端 | `src/lib/chat/` | SSE 流式聊天客戶端封裝（取代舊版 fetch 模式） |
| RAG 管線 | `src/lib/rag/` | 分塊策略（chunker）、混合搜索客戶端（search）、嵌入 Worker（worker） |
| Items 提取 | `src/lib/items/` | 自由文字 → 結構化 items 的 AI 提取器 |
| Memory 提取 | `src/lib/memory/` | 從對話中自動提取助手記憶條目 |
| OpenClaw 客戶端 | `src/lib/openclaw/` | Deprecated re-export，指向 `ai-gateway` |
| n8n 客戶端 | `src/lib/n8n/` | 工作流 CRUD（含超時）+ 節點類型白名單驗證 + Hedy webhook 範本 |
| Hedy.ai 客戶端 | `src/lib/integrations/hedy/` | Hedy API client（types + client）：sessions/me/webhooks，含分頁、重試、區域路由（us/eu）|
| Dev Services 整合 | `src/lib/dev-services/` | GitHub/GitLab/Jira 多服務抽象層：adapters（auth/normalizer/webhook）、orchestration（linker、triggers、workflow-engine）、engines（code-review、diff-parser、summary、test-generation）、approval、crypto、event-worker、factory |
| Webhook 端點 | `src/app/api/webhooks/` | Hedy webhook 接收端點，HMAC 簽章 + 時間戳防重放驗證；Dev Services webhooks 在 `/api/dev-services/webhooks/[service]/[integrationId]` |
| Items API | `src/app/api/items/` | 通用業務資料 CRUD API（列表 + 新增 + 單項 CRUD + AI 提取） |
| Memory API | `src/app/api/memory/` | 助手記憶 CRUD API（列表、新增、刪除/歸檔） |
| Notifications API | `src/app/api/notifications/` | 通知讀取/標記 + 設定 CRUD + 排程生成（支援 cron） |
| Profile API | `src/app/api/profile/` | 使用者 profile 讀取與更新（display name 等） |
| Conversations API | `src/app/api/conversations/[conversationId]/` | 對話更新（標題等）與刪除 |
| RAG Embed API | `src/app/api/rag/embed/` | 嵌入隊列處理端點 |
| Dev Services API | `src/app/api/dev-services/` | Dev projects CRUD/connect、actions（AI 跨服務動作）、worker（cron 觸發）、OAuth `[service]/{authorize,callback}`、webhooks `[service]/[integrationId]` |
| 開發決策上下文 | `.context/` | `prefs/`（編碼規範 + 工作流規則，提交）、`history/commits.jsonl`（決策歸檔，提交）、`current/`（每分支 session.log，本地）|
| 測試基礎設施 | `src/__tests__/` | Mock 工廠（supabase/n8n/openclaw）、e2e flows、helpers、全域 setup |
| 資料庫遷移 | `supabase/migrations/` | 25 個增量遷移檔案（001 profiles → 025 workflow_executions） |
| Docker 部署 | `Dockerfile`, `docker-compose.yml` | 多階段建置，連接外部服務網路 |

## 執行與開發

### 環境變數

參見 `.env.example`：

| 變數 | 用途 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 公開 URL（瀏覽器端） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名金鑰 |
| `SUPABASE_URL` | Supabase 內部 URL（伺服器端） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服務角色金鑰 |
| `ZEROCLAW_GATEWAY_URL` | ZeroClaw AI 閘道位址（預設 `http://localhost:42617`） |
| `ZEROCLAW_GATEWAY_TOKEN` | ZeroClaw Bearer token（透過 `POST /pair` 取得） |
| `ZEROCLAW_TIMEOUT_MS` | ZeroClaw 請求超時（預設 30000ms） |
| `DEFAULT_AI_PROVIDER` | 預設 AI provider：`zeroclaw`（預設）或 `openclaw` |
| `OPENCLAW_GATEWAY_URL` | OpenClaw AI 閘道位址（legacy，可選） |
| `OPENCLAW_GATEWAY_TOKEN` | OpenClaw 認證權杖（legacy，可選） |
| `OPENCLAW_TIMEOUT_MS` | OpenClaw 請求超時（預設 30000ms） |
| `N8N_API_URL` | n8n API 位址 |
| `N8N_API_KEY` | n8n API 金鑰 |
| `N8N_TIMEOUT_MS` | n8n API 請求超時（預設 10000ms） |
| `N8N_WEBHOOK_URL` | n8n 公開 webhook URL（如 `https://n8n.yourdomain.com`） |
| `NEXT_PUBLIC_APP_URL` | 應用公開 URL（預設 `http://localhost:3001`） |
| `CHAINTHINGS_WEBHOOK_SECRET` | Webhook HMAC 簽章密鑰（Hedy webhook fallback；個別整合可在 DB 用每租戶密鑰覆蓋） |
| `CRON_SECRET` | 內部 cron 排程端點驗證密鑰（通知生成 + Dev Services worker） |
| `HEDY_REGION` | Hedy.ai 區域：`us`（預設）或 `eu`，決定 API base URL |
| `HEDY_TIMEOUT_MS` | Hedy API 請求超時（預設 30000ms） |
| `DEV_SERVICE_ENCRYPTION_KEY` | Dev Services 第三方憑證（PAT、API token）AES 加密金鑰（32 bytes，base64） |
| `SUPABASE_COOKIE_NAME` | Supabase auth cookie 名（預設 `sb-localhost-auth-token`） |

### 常用指令

```bash
npm run dev      # 啟動開發伺服器 (Next.js)
npm run build    # 正式環境建置
npm run start    # 啟動正式環境伺服器
npm run lint     # ESLint 檢查
make up          # Docker + ngrok 一鍵啟動
make down        # 停止全部
make status      # 查看運行狀態
```

### Docker 部署

```bash
docker compose up --build -d
```

容器對應連接埠 `3001:3000`，透過 `lab_net` 網路連接 Supabase (kong:8000)、OpenClaw (:18789)、n8n (:5678)。

### 資料庫遷移

遷移檔案位於 `supabase/migrations/`，按編號順序執行：

**核心結構（001–011）**
1. `001_profiles.sql` — profiles 表 + 註冊觸發器 + RLS + tenant_id 輔助函式
2. `002_conversations.sql` — 對話 + 訊息表 + RLS
3. `003_files.sql` — 檔案中繼資料表 + RLS
4. `004_workflows.sql` — n8n 工作流記錄表 + RLS
5. `005_storage.sql` — Storage bucket + 儲存 RLS 策略 (500MB 限制)
6. `006_integrations.sql` — 整合設定表 + RLS
7. `007_items.sql` — 通用業務資料表 + RLS
8. `008_performance_indexes.sql` — 效能索引（messages 覆蓋索引、conversations/workflows 分頁索引）
9. `009_rag_foundation.sql` — pgvector 擴展 + RAG documents/chunks 表 + HNSW 向量索引 + GIN 全文索引 + 混合搜索 RPC（SECURITY INVOKER）+ items 自動嵌入觸發器
10. `010_assistant_memory.sql` — 助手記憶表 + RLS + 記憶自動嵌入觸發器
11. `011_notifications.sql` — 通知設定表 + 通知快取表 + 唯一期間索引（防重複）+ RLS

**強化 / 修補（012–020）**
12. `012_notification_enhancements.sql` — 通知摘要欄位擴充
13. `012_rag_search_tuning.sql` — RAG 混合搜索調整（RRF k 值）
14. `013_workflow_error_message.sql` — workflow 表新增錯誤訊息欄位
15. `014_memory_due_date.sql` — memory 表新增 due_date
16. `015_webhook_per_tenant_secret.sql` — 每租戶 webhook secret（覆蓋全域 `CHAINTHINGS_WEBHOOK_SECRET`）
17. `016_notification_perf_indexes.sql` — 通知查詢效能索引
18. `017_jina_embedding_1024.sql` — 嵌入維度切換為 Jina 1024
19. `018_rag_unify_rpc.sql` — RAG 搜索 RPC 統一介面
20. `019_items_external_id_unique.sql` — items external_id 唯一索引（Hedy backfill 去重依賴）

**Task Center + Dev Services（020–025）**
21. `020_task_batch_fields.sql` — 任務批量操作欄位（reminder、completion_at）
22. `021_dev_service_tables.sql` — Dev Services 整合表 + webhook events 隊列
23. `022_dev_projects.sql` — Dev Projects 表（多服務聚合）
24. `023_dev_service_fixes.sql` — Dev Services 修補（race-safe workflow）
25. `024_approval_tokens.sql` — Dev Services AI 動作的人工審批 token
26. `025_workflow_executions.sql` — 工作流執行歷史表

## 測試策略

專案使用 **Vitest** 作為測試框架，目前有 **28 個測試檔案、213 個測試案例**，全部通過。

### 測試涵蓋範圍

**API 路由**

| 路由 | 測試檔案 | 測試數 |
|------|----------|--------|
| `/api/chat` | `route.test.ts` | 9 |
| `/api/conversations/[conversationId]` | `route.test.ts` | 9 |
| `/api/profile` | `route.test.ts` | 8 |
| `/api/files/upload` | `route.test.ts` | 6 |
| `/api/workflows/generate` | `route.test.ts` | 7 |
| `/api/integrations` | `route.test.ts` | 23 |
| `/api/integrations/hedy/setup` | `route.test.ts` | 18 |
| `/api/items` | `route.test.ts` | 6 |
| `/api/items/[id]` | `route.test.ts` | 7 |
| `/api/webhooks/hedy/[tenantId]` | `route.test.ts` | 7 |
| `/api/auth/signout` | `route.test.ts` | 2 |

**lib/**

| 模組 | 測試檔案 | 測試數 |
|------|----------|--------|
| `ai-gateway/client` | `client.test.ts` | 11 |
| `ai-gateway/providers` | `providers.test.ts` | 8 |
| `n8n/client` | `client.test.ts` | 12 |
| `n8n/validation` | `validation.test.ts` | 6 |
| `n8n/templates/hedy-webhook` | `hedy-webhook.test.ts` | 7 |
| `openclaw/client` | `client.test.ts` | 1 |
| `dev-services/crypto` | `crypto.test.ts` | 6 |
| `dev-services/approval` | `approval.test.ts` | 10 |
| `dev-services/adapters/github-normalizer` | `github-normalizer.test.ts` | 5 |
| `dev-services/adapters/github-webhook` | `github-webhook.test.ts` | 7 |
| `dev-services/adapters/jira-webhook` | `jira-webhook.test.ts` | 6 |
| `dev-services/engines/diff-parser` | `diff-parser.test.ts` | 4 |
| `dev-services/orchestration/linker` | `linker.test.ts` | 5 |
| `dev-services/orchestration/workflow-engine` | `workflow-engine.test.ts` | 5 |
| `chat/stream-client` | `stream-client.test.ts` | 5 |
| `memory/extractor` | `extractor.test.ts` | 4 |

**端對端**

| 測試檔案 | 測試數 |
|----------|--------|
| `__tests__/e2e/api-flows.test.ts` | 9 |

### 測試基礎設施

- `src/__tests__/setup.ts` — 全域 mock 設定（Supabase、AI Gateway、n8n）
- `src/__tests__/mocks/supabase.ts` — Supabase 客戶端 mock 工廠（支援 select/eq/is/in/single/maybeSingle/insert/update/upsert/delete chains）
- `src/__tests__/mocks/n8n.ts` — n8n 工作流 mock
- `src/__tests__/mocks/openclaw.ts` — AI Gateway mock（含 chat + embeddings）
- `src/__tests__/helpers.ts` — 測試輔助函式
- `src/__tests__/e2e/` — 端對端 API flow 測試（多 endpoint 串接）

### 執行測試

```bash
npx vitest run        # 執行所有測試
npx vitest run --reporter=verbose  # 詳細輸出
```

### 待補充

- Supabase RLS 策略測試（含 RAG 跨租戶隔離驗證 — 需實機 Supabase）
- RAG 管線單元測試（`lib/rag/{chunker,worker,search}`）
- 中介軟體認證邏輯測試（`src/middleware.ts`）
- Notifications API 路由測試（`/api/notifications`、`/settings`、`/generate`）
- Memory API 路由測試（`/api/memory`）
- Items extract API 測試（`/api/items/extract`）
- RAG embed API 測試（`/api/rag/embed`）
- Dev Services 路由測試（`/api/dev-services/{actions,worker,projects,*/authorize,*/callback,webhooks/*}`）
- Hedy backfill / check API 測試（`/api/integrations/hedy/{backfill,check}`）

## 編碼規範

- **語言**: TypeScript (strict 模式)
- **樣式**: Tailwind CSS 4（內聯 utility classes）
- **Lint**: ESLint (next/core-web-vitals + next/typescript)
- **路徑別名**: `@/*` -> `./src/*`
- **建置輸出**: `standalone` 模式（用於 Docker）
- **Cookie 名稱**: 可透過 `SUPABASE_COOKIE_NAME` 環境變數設定（預設 `sb-localhost-auth-token`）

## AI 使用指引

- 本專案使用 `src/lib/ai-gateway/` 作為 AI 閘道抽象層，支援 ZeroClaw（預設）和 OpenClaw（legacy）
- **每租戶隔離**：每個租戶可在 `chainthings_integrations` 表設定獨立的 `api_token` 和 `system_prompt`
- **RAG 檢索增強**：聊天 API (`/api/chat`) 自動嵌入用戶訊息 → 混合搜索（向量 + 全文 + RRF）→ 注入相關 context 到 AI 提示詞
  - RAG 失敗為非致命錯誤，不影響聊天功能
  - 回覆中包含 `sources` 欄位引用來源文件
- **嵌入管線**：新增/更新 items 或 memory entries 時自動觸發 PostgreSQL trigger → 排隊至 `rag_documents` → Worker 分塊 + 嵌入 → 存入 `rag_chunks`
- **助手記憶**：每租戶持久記憶（task/preference/fact/project/summary），AI 回答時自動引用
- 聊天 API 支援 `tool` 參數，當 `tool === "n8n"` 時注入 n8n 工作流助手系統提示詞
- 工作流產生 API (`/api/workflows/generate`) 直接產生 n8n 工作流 JSON
- AI 回應中的 `n8n-workflow` 程式碼區塊會被自動解析，經**節點類型白名單驗證**後推送到 n8n
- 白名單位於 `src/lib/n8n/validation.ts`，僅允許安全的轉換/路由節點（webhook、set、if、switch 等），禁止 code、httpRequest 等可執行任意邏輯的節點
- **AI 通知摘要**：Dashboard 通知面板，由 cron 排程觸發 AI 生成每週/雙週/每天摘要，快取到 DB 減少 token 消耗

## 安全機制

- **RAG 租戶隔離**：混合搜索 RPC 使用 `SECURITY INVOKER`，從 RLS context 取得 `tenant_id`，禁止 caller 傳入任意 tenant UUID
- **嵌入 Worker 並發安全**：使用 compare-and-set（`status='pending'` → `'processing'`）防止多 worker 重複處理
- **通知去重**：`notification_cache` 表有 `(tenant_id, user_id, period_start, period_end)` unique 索引 + upsert 操作
- **Webhook 認證**：HMAC-SHA256 簽章 + 時間戳防重放（5 分鐘窗口），租戶 ID 綁定 URL 路徑
- **n8n 節點白名單**：AI 產生的工作流僅允許預定義的安全節點類型
- **n8n 工作流標籤**：所有工作流自動標記 `chainthings` + `tenant:{tenant_id}`
- **服務金鑰隔離**：n8n 工作流 JSON 不包含 Supabase service role key，改用 HMAC 認證的 API 端點
- **外部服務超時**：n8n（10s）和 AI Gateway（30s）請求均有 AbortController 超時保護
- **中介軟體快速路徑**：無 auth cookie 時直接重定向，避免不必要的 Supabase 往返
- **時區驗證**：通知設定 API 驗證 timezone 是否為合法 IANA 時區名稱

## 變更記錄 (Changelog)

| 日期 | 操作 | 說明 |
|------|------|------|
| 2026-03-11 | 初始掃描 | 首次產生 CLAUDE.md，覆蓋率 100% |
| 2026-03-13 | 安全修復 | Hedy webhook HMAC 認證、n8n 節點白名單、OpenClaw 每租戶隔離、service role key 移除 |
| 2026-03-13 | 測試補充 | 新增 71 個單元測試覆蓋所有 API 路由 |
| 2026-03-13 | 效能優化 | 外部服務超時、資料庫效能索引、中介軟體快速路徑、列表分頁 |
| 2026-03-13 | 文檔更新 | 更新 CLAUDE.md 反映新增模組、安全機制、測試策略、環境變數 |
| 2026-03-16 | AI 閘道遷移 | 新增 `src/lib/ai-gateway/` 抽象層，支援 ZeroClaw（預設）和 OpenClaw（legacy），108 個測試全數通過 |
| 2026-03-17 | RAG + 個人秘書 | 新增 pgvector RAG（混合搜索 + RRF）、助手記憶、AI 通知摘要、Meeting Notes 手動創建、嵌入管線；3 個 DB migrations（009-011）、7 個新 API 路由、Dashboard 通知面板 |
| 2026-04-22 | Task Center + Dev Services | 新增任務中心（批量勾選/刪除/設提醒/標完成）、GitHub/GitLab/Jira 多服務整合（OAuth + PAT + 加密憑證）、Dev Projects 聚合層、AI 跨服務動作 + 人工審批 token、race-safe 工作流 worker（cron 觸發）；6 個 DB migrations（020-025）、9 個新 API 路由 |
| 2026-04-29 | Hedy backfill + 重設密碼 + 開發決策上下文 | 新增 Hedy 歷史會議回填（一鍵 backfill + connection check）、Hedy API client lib（types + client，含分頁/重試/區域路由）、忘記密碼 + 重設密碼頁、`.context/` 開發決策歸檔基礎設施（commits.jsonl + prefs/）、修補 `/api/integrations` partial unique index 上的 upsert bug 與 Hedy 自然語言 dueDate 處理 |

## .context 项目上下文

> 项目使用 `.context/` 管理开发决策上下文。

- 编码规范：`.context/prefs/coding-style.md`
- 工作流规则：`.context/prefs/workflow.md`
- 决策历史：`.context/history/commits.md`

**规则**：修改代码前必读 prefs/，做决策时按 workflow.md 规则记录日志。
