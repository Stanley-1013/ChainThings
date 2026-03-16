# 📋 實施計劃：RAG + 通知系統 + Meeting Notes 創建

## 任務類型
- [x] 前端 (→ Gemini)
- [x] 後端 (→ Codex)
- [x] 全棧 (→ 並行)

## 需求增強（結構化）

### 目標
為 ChainThings 多租戶應用添加 RAG（檢索增強生成）能力，使 ZeroClaw AI 助手能檢索會議記錄、待辦事項和個人記憶，實現「個人秘書」體驗。同時新增 Dashboard 通知面板和 Meeting Notes 手動創建功能。

### 技術約束
- 所有數據存放 Supabase 後端（PostgreSQL + Storage）
- 使用 pgvector 擴展實現向量資料庫
- 混合搜索（向量 + 全文）搭配 RRF 排名融合
- ZeroClaw 為主要 AI provider（POST /webhook 格式，單一 message 字串）
- 自託管 Supabase（Docker），可啟用 pgvector、pg_cron 擴展
- 遷移檔案從 009 開始，遵循增量模式
- 所有新表需 tenant_id + RLS 策略
- 現有超時模式：AI 30s、n8n 10s

### 範圍邊界
- **包含**：RAG 嵌入管線、混合搜索、助手記憶、通知系統、Meeting Notes CRUD、語音轉文字（若 ZeroClaw 支援）
- **排除**：端對端加密、即時協作編輯、外部 LLM reranker（先用 RRF，後續可加）
- **延遲**：RLS 策略測試（現有待補項目，可一併補齊但非本計劃核心）

### 驗收標準
1. 用戶問「幫我總結最近一週的會議紀錄」→ AI 回覆引用具體會議內容
2. 用戶問「我還有哪些代辦事項」→ AI 從 meeting notes 的 actionItems 中檢索回答
3. Dashboard 通知面板可開啟/關閉，頻率可調（每週/每天），早上 9 點按用戶時區生成
4. 通知內容快取到後端，不重複呼叫 AI
5. Meeting Notes 頁面可手動新增文字/上傳檔案
6. 所有租戶數據完全隔離（RAG 搜索範圍、記憶、通知）

---

## 技術方案

### 架構選型：App-managed RAG + PostgreSQL Queue + pg_cron

**理由**：最符合現有架構（Next.js API routes + Supabase），最強租戶隔離控制，無需依賴 n8n 做關鍵路徑。

**數據流**：
```
內容寫入 → 標記 embedding 待處理 → pg_cron/API worker 分塊+嵌入 → 存入向量表
                                                                          ↓
用戶提問 → 嵌入查詢 → 混合搜索(向量+全文+RRF) → 注入 context → ZeroClaw 生成回覆
```

### 嵌入模型策略
- **首選**：ZeroClaw embedding endpoint（若有，需確認 API）
- **備選**：OpenClaw embedding endpoint（OpenAI 相容）
- **抽象層**：在 `src/lib/ai-gateway/` 新增 `embeddings.ts`，與 chat 相同的 provider 切換模式
- **向量維度**：先確認 provider 再鎖定（常見 1536 或 768）

### 混合搜索設計
- **語義搜索**：pgvector HNSW 索引 + cosine distance
- **全文搜索**：PostgreSQL tsvector + GIN 索引
- **融合**：SQL RPC 函數內實現 RRF（Reciprocal Rank Fusion），k=60
- **過濾**：`tenant_id` 先行過濾，再按 `source_type` 篩選

---

## 實施步驟

### Phase 1：資料庫基礎（後端）
**預期產物**：3 個遷移檔案

#### Step 1.1：RAG 基礎表（`009_rag_foundation.sql`）

```sql
-- 啟用 pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- RAG 文件表（追蹤哪些源文件需要嵌入）
CREATE TABLE chainthings_rag_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('item', 'conversation', 'memory')),
  source_id UUID NOT NULL,
  source_version INTEGER DEFAULT 1,
  title TEXT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  metadata JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, source_type, source_id)
);

-- RAG 分塊表（含向量嵌入）
CREATE TABLE chainthings_rag_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES chainthings_rag_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding vector(1536),  -- 維度待確認 provider 後可能調整
  token_count INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(document_id, chunk_index)
);

-- 索引
CREATE INDEX idx_rag_documents_tenant_status ON chainthings_rag_documents(tenant_id, status);
CREATE INDEX idx_rag_documents_source ON chainthings_rag_documents(tenant_id, source_type, source_id);
CREATE INDEX idx_rag_chunks_tenant ON chainthings_rag_chunks(tenant_id);
CREATE INDEX idx_rag_chunks_document ON chainthings_rag_chunks(document_id);
CREATE INDEX idx_rag_chunks_tsv ON chainthings_rag_chunks USING GIN(content_tsv);
CREATE INDEX idx_rag_chunks_embedding ON chainthings_rag_chunks USING hnsw(embedding vector_cosine_ops);

-- RLS
ALTER TABLE chainthings_rag_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chainthings_rag_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON chainthings_rag_documents
  FOR ALL USING (tenant_id = chainthings_current_tenant_id());
CREATE POLICY "tenant_isolation" ON chainthings_rag_chunks
  FOR ALL USING (tenant_id = chainthings_current_tenant_id());
```

#### Step 1.2：助手記憶表（`010_assistant_memory.sql`）

```sql
CREATE TABLE chainthings_memory_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('task', 'preference', 'fact', 'project', 'summary')),
  content TEXT NOT NULL,
  importance INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'expired')),
  source_type TEXT,  -- 'item', 'conversation', 'manual'
  source_id UUID,
  last_referenced_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_memory_tenant_status ON chainthings_memory_entries(tenant_id, status);
CREATE INDEX idx_memory_tenant_category ON chainthings_memory_entries(tenant_id, category);

ALTER TABLE chainthings_memory_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON chainthings_memory_entries
  FOR ALL USING (tenant_id = chainthings_current_tenant_id());
```

#### Step 1.3：通知系統表（`011_notifications.sql`）

```sql
-- 通知設定
CREATE TABLE chainthings_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  enabled BOOLEAN DEFAULT false,
  frequency TEXT DEFAULT 'weekly' CHECK (frequency IN ('daily', 'biweekly', 'weekly')),
  timezone TEXT DEFAULT 'Asia/Taipei',
  send_hour_local INTEGER DEFAULT 9 CHECK (send_hour_local BETWEEN 0 AND 23),
  last_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- 通知快取
CREATE TABLE chainthings_notification_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  content JSONB NOT NULL,  -- { summary, actionItems, reminders }
  source_watermark TIMESTAMPTZ,  -- 最新源資料時間戳
  status TEXT DEFAULT 'generated' CHECK (status IN ('generating', 'generated', 'shown', 'expired')),
  scheduled_for_utc TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  shown_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notif_settings_tenant ON chainthings_notification_settings(tenant_id, user_id);
CREATE INDEX idx_notif_cache_tenant ON chainthings_notification_cache(tenant_id, user_id, status);
CREATE INDEX idx_notif_cache_schedule ON chainthings_notification_cache(scheduled_for_utc, status);

ALTER TABLE chainthings_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chainthings_notification_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON chainthings_notification_settings
  FOR ALL USING (tenant_id = chainthings_current_tenant_id());
CREATE POLICY "tenant_isolation" ON chainthings_notification_cache
  FOR ALL USING (tenant_id = chainthings_current_tenant_id());
```

---

### Phase 2：RAG 嵌入管線（後端）
**預期產物**：`src/lib/rag/` 模組

#### Step 2.1：嵌入抽象層
- 檔案：`src/lib/ai-gateway/embeddings.ts`
- 功能：`generateEmbedding(text: string, tenantId?: string): Promise<number[]>`
- 支援 ZeroClaw/OpenClaw provider 切換，同 chat provider 模式
- AbortController 超時保護

#### Step 2.2：分塊策略
- 檔案：`src/lib/rag/chunker.ts`
- Meeting Notes：結構感知分塊（按標題/說話者/段落分割）
- 回退：600-900 token 視窗 + 80-120 token 重疊
- 計算 content_hash 避免重複嵌入

#### Step 2.3：嵌入 Worker
- 檔案：`src/lib/rag/worker.ts`
- API Route：`src/app/api/rag/embed/route.ts`（POST，供 pg_cron 呼叫）
- 流程：查詢 status='pending' 文件 → 分塊 → 嵌入 → 寫入 chunks 表
- 批次處理：每次最多 10 個文件，避免超時
- 冪等性：content_hash 比對，已處理跳過

#### Step 2.4：混合搜索 RPC
- 檔案：`supabase/migrations/012_hybrid_search_rpc.sql`（或在 009 中）
- PostgreSQL 函數：`rag_hybrid_search(query_embedding vector, query_text text, p_tenant_id uuid, p_source_types text[], p_limit int)`
- 實現：CTE semantic_search + CTE fulltext_search → RRF 融合 → 返回 top-k chunks
- **關鍵安全**：函數內 `WHERE tenant_id = p_tenant_id` 強制租戶隔離

#### Step 2.5：自動嵌入觸發
- 當 `chainthings_items` 新增/更新時 → 自動在 `rag_documents` 插入/更新 pending 記錄
- 實現方式：PostgreSQL trigger 或 API route 層邏輯
- 先支援 `meeting_note` 類型，後續擴展 conversation summary

---

### Phase 3：Chat API RAG 整合（後端）
**預期產物**：更新 `src/app/api/chat/route.ts`

#### Step 3.1：查詢嵌入 + 檢索
- 在現有 chat flow 中，profile lookup 後：
  1. 嵌入用戶最新訊息
  2. 呼叫 `rag_hybrid_search` RPC（限 top 5 chunks）
  3. 從 `memory_entries` 取 active 記憶（按 importance 排序）

#### Step 3.2：Context 注入
- 構建 context block：
  ```
  [相關會議記錄]
  - {chunk.title}: {chunk.content}

  [待辦事項]
  - {memory.content}

  [個人記憶]
  - {memory.content}
  ```
- ZeroClaw：注入 context 到 message 字串前段（因為是 flat message 格式）
- OpenClaw：注入為額外 system message
- 控制總 token：context block 最多 2000 tokens，超出截斷最低 relevance 的 chunks

#### Step 3.3：來源引用
- AI 回覆中插入 `[來源: {document_title}]` 標記
- 回傳 metadata 中包含 `sources: [{id, title, type}]`

---

### Phase 4：通知系統（後端 + 前端）
**預期產物**：API routes + Dashboard UI 組件

#### Step 4.1：通知設定 API
- `src/app/api/notifications/settings/route.ts`
- GET：取得用戶通知設定
- PUT：更新設定（enabled, frequency, timezone）
- 首次存取自動建立預設設定（enabled=false, weekly, Asia/Taipei）

#### Step 4.2：通知生成 API
- `src/app/api/notifications/generate/route.ts`（POST，供 cron 呼叫）
- 流程：
  1. 查詢所有 enabled 且到達生成時間的用戶
  2. 按用戶時區判斷是否到達 09:00
  3. 檢查 source_watermark 是否有新資料（無新資料 → 跳過，節省 token）
  4. 取最近 period 的 meeting notes + action items + memories
  5. 呼叫 ZeroClaw 生成摘要
  6. 快取到 `notification_cache` 表

#### Step 4.3：通知讀取 API
- `src/app/api/notifications/route.ts`
- GET：取最新快取通知（status=generated or shown）
- PATCH：標記為 shown

#### Step 4.4：pg_cron 排程
- 每小時執行一次，檢查各時區是否有用戶到達 09:00
- 呼叫 `/api/notifications/generate` 觸發生成
- 或直接用 PostgreSQL function + pg_net 呼叫 API endpoint

#### Step 4.5：Dashboard 通知面板 UI
- 位置：Dashboard 頁面新增 `NotificationPanel` 組件
- 組件：`Card` + `ScrollArea` + `Badge`
- 狀態：
  - 未啟用：引導用戶到 Settings 開啟
  - 已啟用無資料：Empty state（「通知將在下次排程時生成」）
  - 有資料：顯示摘要、待辦事項列表、提醒
- 設定快捷入口：CardHeader 齒輪圖標 → Settings

---

### Phase 5：Meeting Notes 創建（前端 + 後端）
**預期產物**：新頁面 + API 更新

#### Step 5.1：Items API 擴展
- `src/app/api/items/route.ts` 新增 POST 方法
- Body：`{ type, title, content, metadata? }`
- 寫入 `chainthings_items` + 自動觸發 RAG 嵌入

#### Step 5.2：Meeting Notes 創建頁面
- 路徑：`src/app/(protected)/items/new/page.tsx`
- 使用 shadcn/ui `Tabs` 組件切換模式：
  - **文字輸入**：`Textarea` with auto-resize，支援貼上逐字稿
  - **檔案上傳**：拖放區域（reuse 現有 file upload 邏輯），支援 .txt, .md, .docx
  - **語音轉文字**：Record button（需確認 ZeroClaw/OpenClaw 支援度）
- 提交後：
  1. POST `/api/items`
  2. 可選：呼叫 AI 自動提取 keyPoints + actionItems
  3. 跳轉到 detail 頁面

#### Step 5.3：AI 自動提取
- `src/app/api/items/extract/route.ts`（POST）
- 將原文發給 ZeroClaw，要求提取：標題、關鍵要點、待辦事項
- 更新 item 的 metadata
- 同時觸發記憶提取（從 actionItems 建立 memory_entries）

#### Step 5.4：Items 列表頁更新
- 新增「+ 新增」按鈕在 PageHeader 旁
- 連結到 `/items/new`

---

### Phase 6：助手記憶管理（前端 + 後端）
**預期產物**：API + Settings UI

#### Step 6.1：Memory API
- `src/app/api/memory/route.ts`
- GET：列出 active 記憶（分類、分頁）
- POST：手動新增記憶
- DELETE：刪除/歸檔記憶

#### Step 6.2：Settings 記憶管理 UI
- 在 Settings 頁面新增 Tab「AI & 記憶」
- 顯示：記憶列表（按類別分組）、清除全部按鈕
- RAG 範圍偏好：勾選哪些資料類型參與搜索（meeting_notes, conversations, memories）

---

### Phase 7：前端 RAG 體驗增強（前端）
**預期產物**：Chat UI 更新

#### Step 7.1：RAG 載入狀態
- Chat 中 AI 回覆前顯示狀態序列：
  - 「搜索文件中...」→「分析會議記錄...」→「生成回覆中...」
- 使用 shadcn/ui `Skeleton` 組件

#### Step 7.2：來源引用 UI
- AI 回覆中的 `[來源: xxx]` 渲染為可點擊 `Badge`
- 點擊開啟 shadcn/ui `Sheet` 側面板，顯示完整源文件摘錄
- 響應式：手機端 Sheet 全寬

---

## 關鍵文件

| 文件 | 操作 | 說明 |
|------|------|------|
| `supabase/migrations/009_rag_foundation.sql` | 新增 | pgvector + RAG documents/chunks 表 + 混合搜索 RPC |
| `supabase/migrations/010_assistant_memory.sql` | 新增 | 助手記憶表 |
| `supabase/migrations/011_notifications.sql` | 新增 | 通知設定 + 快取表 |
| `src/lib/ai-gateway/embeddings.ts` | 新增 | 嵌入抽象層（ZeroClaw/OpenClaw） |
| `src/lib/rag/chunker.ts` | 新增 | 分塊策略 |
| `src/lib/rag/worker.ts` | 新增 | 嵌入 Worker |
| `src/lib/rag/search.ts` | 新增 | 混合搜索客戶端 |
| `src/app/api/chat/route.ts` | 修改 | 注入 RAG context |
| `src/app/api/items/route.ts` | 修改 | 新增 POST 方法 |
| `src/app/api/items/extract/route.ts` | 新增 | AI 自動提取 |
| `src/app/api/rag/embed/route.ts` | 新增 | 嵌入 Worker API |
| `src/app/api/notifications/settings/route.ts` | 新增 | 通知設定 API |
| `src/app/api/notifications/generate/route.ts` | 新增 | 通知生成 API |
| `src/app/api/notifications/route.ts` | 新增 | 通知讀取 API |
| `src/app/api/memory/route.ts` | 新增 | 記憶 CRUD API |
| `src/app/(protected)/items/new/page.tsx` | 新增 | Meeting Notes 創建頁 |
| `src/app/(protected)/items/page.tsx` | 修改 | 新增「+ 新增」按鈕 |
| `src/app/(protected)/dashboard/page.tsx` | 修改 | 新增通知面板 |
| `src/app/(protected)/settings/page.tsx` | 修改 | 新增 AI & 記憶 Tab |
| `src/app/(protected)/chat/[conversationId]/page.tsx` | 修改 | RAG 載入狀態 + 來源引用 |
| `.env.example` | 修改 | 新增 EMBEDDING_* 環境變數 |

## 風險與緩解

| 風險 | 嚴重度 | 緩解措施 |
|------|--------|----------|
| 嵌入模型 provider 不確定（ZeroClaw 是否有 embedding endpoint） | 高 | 抽象層設計，先用 OpenClaw embedding 驗證，ZeroClaw 就緒後切換 |
| 向量維度鎖定後難以更改 | 高 | 先確認 provider，一次性鎖定；如需更換，migration 重建索引 |
| 跨租戶資料洩漏（RAG 搜索繞過 RLS） | 極高 | 所有 SQL RPC 強制 `WHERE tenant_id =`；搜索函數用 `SECURITY DEFINER` + 參數化 tenant_id |
| Token 成本爆炸（大量嵌入 + 通知生成） | 中 | content_hash 去重；通知 source_watermark 跳過無變化期間；context 限制 2000 tokens |
| pg_cron 可靠性（跨時區 09:00 排程） | 中 | 每小時掃描一次，DB 記錄生成狀態避免重複；失敗重試機制 |
| 語音轉文字功能可用性不確定 | 低 | 列為 Phase 5 可選功能，文字/檔案上傳優先 |

## 依賴關係

```
Phase 1 (DB) ──→ Phase 2 (RAG Pipeline) ──→ Phase 3 (Chat Integration)
     │                                              │
     └──→ Phase 4 (Notifications) ←────────────────┘
     │
     └──→ Phase 5 (Meeting Notes CRUD) ──→ Phase 2 (觸發嵌入)
     │
     └──→ Phase 6 (Memory Management)

Phase 7 (Chat UI) 依賴 Phase 3 完成
```

**建議執行順序**：Phase 1 → Phase 2 → Phase 5 → Phase 3 → Phase 6 → Phase 4 → Phase 7

## NPM 依賴（新增）

```json
{
  "@supabase/supabase-js": "已有",
  "pgvector": "不需要（直接用 SQL）"
}
```

無需額外 NPM 套件。pgvector 操作透過 Supabase SQL RPC 完成，嵌入透過 AI gateway 抽象層呼叫。

## SESSION_ID（供 /ccg:execute 使用）
- CODEX_SESSION: 019cf763-9142-7983-bb42-de2a038fa989
- GEMINI_SESSION: f3fc230c-654d-467d-81c2-12cb64253e96
