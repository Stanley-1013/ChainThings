# 實施計劃 v3：Chat + 通知修復

**規劃時間**：2026-03-26
**預估工作量**：9 任務點

---

## 問題 1：Chat — ZeroClaw 用工具找檔案而非用 RAG context

### 修復（v3：全部禁用工具 + 驗證優先）

**改動 1**：ZeroClaw config — 禁用 webhook 的**所有**工具

先驗證 `non_cli_excluded_tools` 是否對 webhook 生效：
```bash
# Step 1: 測試當前行為（預期：回覆含 <tool_call>）
curl -X POST http://zeroclaw:42617/webhook -d '{"message":"read file /etc/hostname"}'

# Step 2: 更新 config，禁用所有工具
PUT /api/config → non_cli_excluded_tools = ["*"] 或列舉全部

# Step 3: 再次測試（預期：回覆不含 <tool_call>）
curl -X POST http://zeroclaw:42617/webhook -d '{"message":"read file /etc/hostname"}'
```

如果 `non_cli_excluded_tools` 不影響 webhook → fallback 方案：
- 用 ZeroClaw `/api/config` 設 `[agent] max_tool_iterations = 0` 或 `tool_dispatcher = "none"`

**禁用全部工具的理由**（含 memory_recall）：
- ChainThings 的 Supabase 是 memory 權威（tenant-safe, SQL queryable）
- ZeroClaw memory 已有污染（存了所有 system prompt 為 conversation）
- 不需要 ZeroClaw 自己去 recall —— RAG context 已注入到 prompt

**改動 2**：Chat system prompt — 層級式指引

```
You are a personal secretary (私人秘書) for the user.
When relevant context is provided below, use it to answer the user's question.
If the provided context is insufficient, say what information is missing.
If no context is provided, answer using your general knowledge.
Always respond in Traditional Chinese (繁體中文) unless the user writes in another language.
Do not include any XML tags, tool calls, or system markup in your responses.
```

**改動 3**：`stripToolCalls()` — bounded retry

```
if (stripToolCalls 後只剩空白) {
  if (retryCount === 0) {
    // Retry ONCE with 30s timeout + stronger no-tools instruction
    chatMessages.push({ role: "system", content: "回答用戶的問題。不要使用工具。直接用文字回答。" });
    retry with retryCount = 1
  } else {
    return "抱歉，我目前無法處理這個請求，請稍後再試。"
  }
}
```
- 最多 1 次 retry
- Retry 用更短的 timeout（30s vs 正常 60s）
- 記錄 retry 事件到 console.warn（觀察頻率）

---

## 問題 2：通知 — DB 驅動結構 + AI summary only

### 修復（v3：明確向後相容 + 資料過濾）

**改動 4**：通知生成 — 結構化重寫

```typescript
async function generateForTarget(target) {
  // Step 1: DB 查詢（確定性）
  const actionItems = await db.memory_entries
    .where({ tenant_id, status: 'active', category: 'task' })
    .orderBy('importance', 'desc')
    .limit(8);

  const recentMeetings = await db.items
    .where({ tenant_id, type: 'meeting_note' })
    .where('created_at', '>=', periodStart)
    .orderBy('created_at', 'desc')
    .limit(5);

  const upcomingDeadlines = await db.memory_entries
    .where({ tenant_id, status: 'active', category: 'task' })
    .whereNotNull('due_date')
    .where('due_date', '<=', sevenDaysFromNow)
    .orderBy('due_date', 'asc')
    .limit(5);

  // Step 2: AI 只寫 summary（純文字，不需要 JSON）
  let summary: string;
  try {
    const aiResponse = await chatCompletion([
      { role: "system", content: "用繁體中文寫 2-3 句話總結以下資料的重點。只輸出摘要文字，不要其他內容。" },
      { role: "user", content: contextFromDBData }
    ]);
    summary = aiResponse.choices[0]?.message?.content?.trim() || fallback;
  } catch {
    summary = `本期有 ${actionItems.length} 筆待辦事項和 ${recentMeetings.length} 筆會議記錄。`;
  }

  // Step 3: 組合存入 cache
  const content = {
    summary,
    actionItems: actionItems.map(t => ({
      task: t.content.slice(0, 100),
      priority: t.importance >= 8 ? "high" : t.importance >= 5 ? "medium" : "low",
      dueDate: t.due_date || null
    })),
    reminders: upcomingDeadlines.map(d => {
      const days = daysUntil(d.due_date);
      return `${d.content.slice(0, 80)}（${days <= 0 ? '已逾期' : days + ' 天後到期'}）`;
    }),
    recentMeetings: recentMeetings.map(m => ({
      title: m.title || '未命名會議',
      date: m.created_at
    }))
  };

  await upsertNotificationCache(content);
}
```

**改動 5**：Notification panel — 向後相容 + 新欄位

```typescript
// 安全讀取（舊 cache 可能沒有 recentMeetings）
const meetings = latest.content.recentMeetings ?? [];
const items = latest.content.actionItems ?? [];
const reminders = latest.content.reminders ?? [];
```

新增「最近會議」區塊（有資料時才顯示）。

**資料品質過濾**（改動 4 內）：
- `status = 'active'` 只取活躍條目
- `importance` 排序取前 8 筆
- `content.slice(0, 100)` 截斷過長內容
- 去重：同 tenant 內相同 content 的 task 只取一筆

---

## 改動清單

| 文件 | 操作 | 說明 |
|------|------|------|
| ZeroClaw config (runtime) | 修改 | 禁用所有 webhook tools（驗證後執行）|
| `src/app/api/chat/route.ts` | 修改 | 層級式 system prompt + bounded retry |
| `src/app/api/notifications/generate/route.ts` | 重寫 | DB 驅動結構 + AI summary only |
| `src/components/shared/notification-panel.tsx` | 修改 | 向後相容 + recentMeetings |

---

## 驗收標準

### Chat
- [ ] 問「幫我整理會議重點」→ 用 RAG context 回答，不提到「查看檔案」
- [ ] 問「你好」→ 正常對話
- [ ] ZeroClaw config 驗證：webhook 請求不生成 tool_call XML
- [ ] tool_call-only 回覆 → retry 一次 → 成功或 fallback

### 通知
- [ ] 有待辦事項 → 結構化顯示（task + priority + dueDate）
- [ ] 有會議記錄 → 顯示最近會議標題 + 日期
- [ ] AI 失敗 → 其他欄位照顯示，summary 用 fallback
- [ ] 舊 cache 資料 → 不壞掉（recentMeetings 可選）

---

## 風險

| 風險 | 緩解 |
|------|------|
| `non_cli_excluded_tools` 不影響 webhook | 先測試；fallback: `max_tool_iterations = 0` |
| Retry 增加延遲 | 30s 短 timeout + 最多 1 次 + logging 觀察頻率 |
| 舊通知 cache 缺少新欄位 | `?? []` 防禦性讀取 |
| memory_entries 品質不一 | importance 排序 + truncation + active filter |

---

## SESSION_ID
- CODEX_SESSION: 019d200f-170a-7712-b46c-280d216513f4
