# 實施計劃 v2：Chat + 通知修復

**規劃時間**：2026-03-26
**預估工作量**：8 任務點

---

## 問題 1：Chat — ZeroClaw 用工具找檔案而非用 RAG context

### 根因分析
不是 prompt 問題，是 ZeroClaw **runtime 層**的問題：
- ZeroClaw config: `auto_approve = ["file_read", "memory_recall"]` → webhook 請求也會觸發 tool
- 模型收到「整理會議重點」→ 嘗試用 file_read 找檔案 → 回傳 `<tool_call>` XML
- 我們 `stripToolCalls()` 把 XML 去掉 → 剩下空白或殘缺回覆

### 修復（configuration-first, prompt-second）

**改動 1**：ZeroClaw config — 禁用 webhook 的 tool 生成

用 `/api/config` PUT 更新 config，新增 `non_cli_excluded_tools`：
```toml
non_cli_excluded_tools = ["file_read", "file_write", "file_edit", "shell", "glob_search", "content_search", "git_operations", "backup", "screenshot"]
```
這讓 webhook（非 CLI）請求不會觸發檔案/系統工具，只保留 memory 相關工具。

**改動 2**：Chat system prompt — 層級式指引（非絕對禁令）

```
舊：You are a helpful AI assistant. Always respond in Traditional Chinese...

新：You are a personal secretary (私人秘書) for the user.
    When relevant context is provided below, use it to answer the user's question.
    If the provided context is insufficient, say what information is missing.
    If no context is provided, answer using your general knowledge.
    Always respond in Traditional Chinese (繁體中文) unless the user writes in another language.
    Do not include any XML tags, tool calls, or system markup in your responses.
```

**改動 3**：`stripToolCalls()` — 空內容時 retry 或 fallback

如果 strip 後只剩空白：
1. **首選**：用原始訊息（含 tool_call XML）重新送一次，加上「請直接回答，不要使用工具」
2. **Fallback**：回傳「抱歉，我目前無法處理這個請求，請稍後再試。」

---

## 問題 2：通知 — AI 不按格式輸出

### 根因分析
MiniMax-M2.7 在 webhook 模式下不可靠地遵循 JSON 格式指令。
反覆修 prompt 是在跟模型行為對抗，不是工程解法。

### 修復（DB 驅動結構 + AI 只做 summary）

**改動 4**：通知生成 — 結構來自 DB，summary 來自 AI

新的 `generateForTarget()` 流程：

```
Step 1: 從 DB 查詢結構化資料（確定性，不壞）
  - actionItems: SELECT content, due_date FROM memory_entries 
                 WHERE category='task' AND status='active'
  - recentMeetings: SELECT title, created_at FROM items 
                    WHERE type='meeting_note' ORDER BY created_at DESC
  - upcomingDeadlines: SELECT content, due_date FROM memory_entries
                       WHERE due_date <= NOW() + '7 days'

Step 2: AI 只寫一段 summary（純文字，不需要 JSON）
  - prompt: 「根據以下資料，用 2-3 句話總結本期重點」
  - 如果 AI 失敗 → summary = "本期有 {N} 筆待辦事項和 {M} 筆會議記錄。"

Step 3: 組合成結構化 content 存入 notification_cache
  {
    summary: AI 摘要或 fallback,
    actionItems: 直接從 DB 查詢結果映射,
    reminders: 從 deadline 資料映射,
    recentMeetings: [{title, date}]
  }
```

**好處**：
- AI 只需「寫一段話」→ 成功率 >> 「輸出 JSON」
- 即使 AI 完全失敗，其他欄位照常顯示
- 通知資料 100% 來自 DB，不丟資料

**改動 5**：Notification panel — 新增 recentMeetings 渲染

前端新增「最近會議」區塊（如果有的話），顯示標題 + 日期。

---

## 改動清單

| 文件 | 操作 | 說明 |
|------|------|------|
| ZeroClaw config (runtime) | 修改 | `non_cli_excluded_tools` 禁用檔案/系統工具 |
| `src/app/api/chat/route.ts` | 修改 | 層級式 system prompt |
| `src/app/api/chat/route.ts` | 修改 | `stripToolCalls` 空內容 retry/fallback |
| `src/app/api/notifications/generate/route.ts` | 重寫 | DB 驅動結構 + AI summary only |
| `src/components/shared/notification-panel.tsx` | 修改 | 新增 recentMeetings 渲染 |

---

## 驗收標準

### Chat
- [ ] 問「幫我整理會議重點」→ 用 RAG context 回答，不提到「查看檔案」
- [ ] 問「你好」→ 正常對話，不被「ONLY context」限制
- [ ] ZeroClaw 回傳 tool_call XML → 用戶看到有意義的回覆（retry 或 fallback）

### 通知
- [ ] 有待辦事項時 → 通知面板顯示結構化的 action items
- [ ] AI summary 失敗時 → 其他欄位照常顯示，summary 用 fallback
- [ ] 無資料時 → 顯示「本期無新資料」

---

## 風險

| 風險 | 緩解 |
|------|------|
| ZeroClaw config API 不支援 `non_cli_excluded_tools` | 先測試 API，fallback 到直接改 container volume 的 config.toml |
| AI summary 品質不穩定 | 只需寫 2-3 句話，要求低；失敗有 fallback |
| DB 查詢的 action items 未經 AI 降噪 | items/extract 已在寫入時做過 AI 提取，memory_entries 有 importance 排序 |

---

## SESSION_ID
- CODEX_SESSION: 019d200f-170a-7712-b46c-280d216513f4
