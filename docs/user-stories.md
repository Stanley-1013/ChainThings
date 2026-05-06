# ChainThings — 使用者故事與測試覆蓋

最後驗證：2026-05-06 · 472 / 472 測試通過（375 unit + 97 integration）

## 角色 (Roles)

- **未登入訪客 (Anon)** — 還沒有帳號或未登入
- **租戶成員 (Tenant Member)** — 已認證的使用者，屬於某個 tenant
- **系統 (System)** — Vercel Cron / GitHub Actions / Webhook 來源
- **第三方 (Third Party)** — Hedy.ai / GitHub / GitLab / Jira webhook

每個 tenant 由註冊時觸發器自動產生獨立 `tenant_id (UUID)`，所有業務資料用 `tenant_id` + RLS 隔離。

---

## 1. 認證 (Auth)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 訪客可以註冊新帳號，註冊後系統自動建立 profile + tenant_id | `/register` + `on_auth_user_created` trigger (001 migration) | `smoke.test.ts × 3` |
| 訪客可以用 email/密碼登入，取得 RLS 認可的 JWT | `/login` + Supabase GoTrue | `smoke.test.ts` |
| 訪客可以用 OAuth (GitHub/Google) 登入，回呼後落到 dashboard | `/callback` route handler | (UI 流程，依靠 Supabase SSR) |
| 已登入使用者可以登出，cookie 與 session 都清掉 | `POST /api/auth/signout` | `signout/route.test.ts × 2` |
| 訪客忘記密碼時可以申請重設信，點連結後設新密碼 | `/forgot-password`、`/reset-password` | (UI，依靠 Supabase SSR) |
| 中介軟體在無 cookie 時直接重導 `/login`，不必往 Supabase 跑一趟 | `src/middleware.ts` 快速路徑 | `__tests__/middleware.test.ts` |
| 任何請求中介軟體都要驗 session，無效時把使用者送回 `/login` | `src/middleware.ts` | 同上 |

---

## 2. 多租戶隔離 (RLS)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 我看不到其他租戶的任何資料（對話、訊息、檔案、工作流、任務、記憶、通知、整合、Dev 專案、RAG 文件/分塊） | 14 張 `chainthings_*` 表的 RLS policy + `chainthings_current_tenant_id()` helper | `rls/* × 97` |
| 我嘗試插入別人 tenant 的資料時會被擋 | `WITH CHECK` clause | `rls/* INSERT spoof` |
| 即使我知道別人 row 的 id，我也無法 update / delete | RLS USING 過濾 | `rls/* UPDATE/DELETE` |
| 別人的子表資料（如 messages、rag_chunks）我用任何 FK 組合都引不到 | Migration 027 加 `WITH CHECK + EXISTS(...)` | `rls/* parent-child FK isolation` |
| 別人的 user_id 不能塞到我自己的 notification 設定裡 | Migration 027 `WITH CHECK (user_id = auth.uid())` | `rls/task_center cross-user spoof` |
| 我登出後 (anon) 任何業務表都看不到任何資料 | RLS USING 篩到 0 rows | `rls/* anon` |

---

## 3. 對話與 RAG 聊天 (Chat)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 我可以開始一段新對話，和 AI 助手對談 | `/chat` page + `POST /api/chat` (SSE 串流) | `api/chat/route.test.ts × 9` |
| 對話自動嵌入我的問題 → 混合搜索（向量 + 全文 + RRF）→ 注入 RAG context | `/api/chat` + `lib/rag/search` + `chainthings_hybrid_search` RPC | `lib/rag/search.test.ts`, `rls/rag.test.ts × 17` |
| RAG 失敗（embedding 服務掛掉）不影響聊天功能 | `/api/chat` 對 RAG 用 try/catch 包起來 | `api/chat/route.test.ts` |
| AI 回覆會帶 `sources` 欄位指出引用了哪些文件 | `/api/chat` | `api/chat/route.test.ts` |
| 我看到的 RAG 結果只會是我自己 tenant 的內容 | `chainthings_hybrid_search` RPC `SECURITY INVOKER` + `Unauthorized: no tenant context` 防護 | `rls/rag.test.ts cross-tenant scoping` |
| 我可以重新命名或刪除舊對話 | `PATCH/DELETE /api/conversations/[id]` | `conversations/[conversationId]/route.test.ts × 9` |
| 我可以選擇 AI 工具（如 n8n 模式）讓助手知道專業情境 | `tool` 參數 | `api/chat/route.test.ts` |
| 對話歷史完全和我同事 (同租戶) 分開 | RLS on `chainthings_conversations + _messages` | `rls/conversations_messages.test.ts × 13` |

---

## 4. 助手記憶 (Memory)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 助手可以從對話中自動萃取記憶條目（任務 / 偏好 / 事實 / 專案 / 摘要） | `lib/memory/extractor` | `lib/memory/extractor.test.ts × 4` |
| 我可以列出、刪除、歸檔我的記憶條目 | `GET/POST/DELETE /api/memory` | `api/memory/route.test.ts` |
| 助手回答時自動引用我的記憶 | `/api/chat` 抓 active memory + 注入 prompt | `api/chat/route.test.ts` |
| 記憶條目新增/更新後自動排隊嵌入到 RAG | `chainthings_queue_memory_embedding` trigger + `lib/rag/worker` | `lib/rag/worker.test.ts` |
| 同租戶內可共用，但跨租戶完全隔離 | RLS on `chainthings_memory_entries` | `rls/task_center.test.ts (memory section)` |

---

## 5. 任務中心 / Items (Task Center)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 我可以列出、新增、編輯、刪除任務 / 筆記 / 任意業務資料 | `GET/POST /api/items`、`GET/PATCH/DELETE /api/items/[id]` | `items/route.test.ts × 6`, `items/[id]/route.test.ts × 7` |
| 我可以丟一段自由文字，AI 幫我抽出結構化任務 | `POST /api/items/extract` | `items/extract/route.test.ts` |
| 我可以批次勾選多個任務同時 → 刪除 / 設提醒 / 標完成 | Migration 020 `task_batch_fields` + UI | `rls/task_center.test.ts (items section)` |
| 我新增的任務自動排嵌入到 RAG，後續對話會引用 | `chainthings_queue_item_embedding` trigger | `lib/rag/worker.test.ts` |
| Hedy backfill 進來的任務不會重複（基於 `external_id` 唯一性） | Migration 019 `items_external_id_unique` | `integrations/hedy/backfill/route.test.ts` |

---

## 6. AI 通知 (Notifications)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| Dashboard 通知面板會顯示 AI 自動產生的每週/雙週/每天摘要 | `(protected)/dashboard` + `GET /api/notifications` | `api/notifications/route.test.ts` |
| 我可以調整通知頻率、時區、發送時間 | `GET/PATCH /api/notifications/settings` | `notifications/settings/route.test.ts` |
| 系統定時 cron 觸發摘要生成（不會重複產生同期間摘要） | `POST /api/notifications/generate` + `notification_cache` 唯一索引 | `notifications/generate/route.test.ts` |
| 通知產生失敗不會重複扣 token（有 `notification_cache.status` 狀態機） | Migration 011 + 016 | `rls/task_center.test.ts (notification_cache)` |
| 我看不到別人的通知，連 user_id 都不能跨用戶寫入 | RLS + Migration 027 | `rls/task_center.test.ts cross-user spoof × 2` |

---

## 7. 工作流自動化 (Workflows / n8n)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| AI 可以根據我的需求產出 n8n 工作流 JSON | `POST /api/workflows/generate` | `workflows/generate/route.test.ts × 7` |
| AI 產生的工作流必須通過節點白名單才會推到 n8n | `lib/n8n/validation` (禁止 code/httpRequest 等) | `n8n/validation.test.ts × 6` |
| 工作流推到 n8n 後自動標 `chainthings + tenant:{id}` 標籤 | `lib/n8n/client` | `n8n/client.test.ts × 12` |
| n8n 工作流不會帶 service-role key（改用 HMAC 認證的 callback） | `lib/n8n/templates/hedy-webhook` | `n8n/templates/hedy-webhook.test.ts × 7` |
| n8n API 請求超過 10s 會被 abort，不會卡死 | `AbortController` 在 client | `n8n/client.test.ts` |
| 工作流執行歷史可以看到結果（success/failure/duration） | `chainthings_workflow_executions` 表 | `rls/files_workflows.test.ts × 19` |

---

## 8. 檔案管理 (Files)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 我可以上傳檔案到 Supabase Storage（500MB 限制） | `POST /api/files/upload` + `chainthings-uploads` bucket | `files/upload/route.test.ts × 6` |
| 我只能存取自己 tenant 資料夾下的檔案 | Storage RLS：`(storage.foldername(name))[1] = tenant_id::text` | `rls/files_workflows.test.ts files section` |
| 我可以列出、刪除自己的檔案中繼資料 | `chainthings_files` 表 + RLS | 同上 |

---

## 9. 第三方整合 (Hedy.ai)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 我可以一鍵設定 Hedy webhook（自動建 n8n workflow + 註冊到 Hedy） | `POST /api/integrations/hedy/setup` | `integrations/hedy/setup/route.test.ts × 18` |
| 我可以一鍵 backfill 過去的 Hedy 會議到我的 tenant | `POST /api/integrations/hedy/backfill` (含分頁/重試/區域) | `integrations/hedy/backfill/route.test.ts` |
| 我可以測試 Hedy 連線狀態（hedy/check） | `GET /api/integrations/hedy/check` | `integrations/hedy/check/route.test.ts` |
| Hedy webhook 進來時驗證 HMAC + timestamp（5 分鐘窗口防重放） | `POST /api/webhooks/hedy/[tenantId]` | `webhooks/hedy/[tenantId]/route.test.ts × 7` |
| 我每個整合可以用獨立的 webhook secret（覆蓋全域） | Migration 015 `webhook_per_tenant_secret` | `integrations/route.test.ts × 23` |
| 我可以新增 / 編輯 / 刪除整合設定（API token 加密儲存） | `GET/POST/PATCH/DELETE /api/integrations` | 同上 |

---

## 10. Dev Services 整合 (GitHub / GitLab / Jira)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 我可以用 OAuth 連結 GitHub / GitLab / Jira | `GET /api/dev-services/[service]/authorize` + `/callback` | `dev-services/[service]/{authorize,callback}/route.test.ts` |
| 我也可以改用 PAT（憑證 AES 加密儲存，從不明文出庫） | `lib/dev-services/crypto` | `dev-services/crypto.test.ts × 6` |
| 第三方 webhook 進來時根據 service 走對應 normalizer | `lib/dev-services/adapters/{github,gitlab,jira}-webhook` | `github-webhook.test.ts × 7`, `jira-webhook.test.ts × 6`, `github-normalizer.test.ts × 5` |
| Webhook 事件進佇列後由 worker 異步處理（cron 觸發） | `chainthings_webhook_events` + `POST /api/dev-services/worker` | `dev-services/worker/route.test.ts` |
| Worker 用 compare-and-set 防止多 worker 重複處理同一事件 | Migration 023 `dev_service_fixes` (race-safe workflow) | 同上 |

---

## 11. Dev Projects (跨服務聚合)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 我可以建立 Dev Project，把同一專案在多個服務（GitHub repo + Jira project）聚合起來 | `POST /api/dev-services/projects` | `dev-services/projects/route.test.ts` |
| 我可以連結 / 解除連結某個整合到 Dev Project | `POST/DELETE /api/dev-services/projects/[id]/connect` | `dev-services/projects/[projectId]/connect/route.test.ts` |
| AI 可以在 Dev Project 範圍內跨服務執行動作（Code Review / Test Gen / Summary） | `lib/dev-services/orchestration/{linker,workflow-engine}` + `POST /api/dev-services/actions` | `linker.test.ts × 5`, `workflow-engine.test.ts × 5`, `dev-services/actions/route.test.ts` |
| 高風險動作會發 approval token，需要我手動點連結批准才執行 | `lib/dev-services/approval` + Migration 024 `approval_tokens` | `approval.test.ts × 10` |
| AI Code Review 可以解析 diff 並產出評論 | `lib/dev-services/engines/diff-parser` | `diff-parser.test.ts × 4` |

---

## 12. AI 閘道 (AI Gateway)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 我可以選擇用 ZeroClaw（預設）或 OpenClaw（legacy） | `lib/ai-gateway/providers` | `providers.test.ts × 8` |
| 我每個租戶可以獨立設定 AI token 和 system prompt | `chainthings_integrations` 表 + tenant 隔離 | `ai-gateway/client.test.ts × 11` |
| AI 請求超過 30s 會 abort 並 retry | `AbortController` + retry policy | `client.test.ts` |
| 串流聊天用 SSE 回傳，前端逐字顯示 | `lib/chat/stream-client` | `stream-client.test.ts × 5` |
| Provider 切換不影響上層 API 介面 | `lib/openclaw` re-export 到 `ai-gateway` | `openclaw/client.test.ts × 1` |

---

## 13. RAG 嵌入管線 (Embedding Worker)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 我新增 / 更新 item 或 memory 時自動排隊到 `chainthings_rag_documents` | PostgreSQL trigger | `rls/rag.test.ts` (trigger side-effect 觀察) |
| Worker 拿 pending document → 分塊 → 嵌入 → 寫 `chainthings_rag_chunks` | `lib/rag/{chunker,worker}` + `POST /api/rag/embed` | `rag/chunker.test.ts`, `rag/worker.test.ts`, `rag/embed/route.test.ts` |
| 多個 worker 同時跑也不會重複處理（CAS：pending → processing） | `lib/rag/worker` | `rag/worker.test.ts` |
| 嵌入維度切到 Jina 1024 後 HNSW 索引也跟著重建 | Migration 017 + 018 | `rls/rag.test.ts × 17` |
| 混合搜索（semantic + fulltext）用 RRF 融合排名 | `chainthings_hybrid_search` RPC | `rls/rag.test.ts hybrid_search RPC` |
| 完全沒嵌入內容時系統不會崩，只是不注入 RAG context | `/api/chat` RAG 為非致命錯誤 | `api/chat/route.test.ts` |

---

## 14. 設定 (Settings & Profile)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 我可以更新自己的 display name | `GET/PATCH /api/profile` | `profile/route.test.ts × 8` |
| 我可以管理我的整合（Hedy + Dev Services） | `/settings` page + `/api/integrations` | `integrations/route.test.ts × 23` |

---

## 15. 端對端流程 (E2E flows)

| 故事 | 對應實作 | 測試 |
|------|---------|------|
| 完整的 chat → save conversation → 再開新對話 → memory 累積 流程不會斷 | `__tests__/e2e/api-flows.test.ts` | `× 9` |

---

## 測試覆蓋總結

| 層級 | 測試檔數 | 案例數 | 平均速度 |
|------|---------|--------|---------|
| Unit + e2e (mock) | 48 | 375 | ~3 秒 |
| Integration (RLS, real Supabase) | 6 | 97 | ~30 秒 |
| **合計** | **54** | **472** | — |

### 已知 / 已修補的安全議題

- **Cross-tenant FK 引用洩漏** — Migration 027 補上 `WITH CHECK + EXISTS(...)` 限制 6 個 child-FK 場景（messages/rag_chunks/integrations/workflow_executions/notification_settings/notification_cache）
- **Hedy webhook 重放** — HMAC + timestamp 5 分鐘窗口
- **n8n 任意程式碼執行** — 節點白名單，禁 code/httpRequest
- **AI 跨服務危險動作** — approval token 必須使用者點連結後才執行
- **Service role key 暴露** — n8n workflow JSON 已不含此 key，改用 HMAC API
- **Dev Services 憑證明文** — AES-GCM 加密儲存

### 尚未覆蓋（追蹤項）

- 前端 page 元件層級測試（依靠手動 + browser）
- OAuth callback 的 cookie roundtrip（依靠 Supabase SSR）
- Hedy webhook 在實際網路抖動下的重試（生產環境觀察）
