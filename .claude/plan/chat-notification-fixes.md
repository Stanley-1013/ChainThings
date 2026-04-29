# 實施計劃：Chat + 通知修復

**規劃時間**：2026-03-26
**預估工作量**：6 任務點
**原則**：最小改動，直接解決問題

---

## 問題 1：Chat — ZeroClaw 以容器視角回答，忽略 RAG context

### 根因
1. **System prompt 太弱**：只說 "You are a helpful AI assistant"，沒有告訴 ZeroClaw 要用提供的 context 回答
2. **ZeroClaw 預設行為是檔案助手**：它有 file_read/file_write 等 tools，會嘗試在工作區找檔案
3. **`stripToolCalls` 丟掉了 tool call 內容**：如果 ZeroClaw 回了 `<tool_call>` 想去讀檔案，我們 strip 掉就只剩空內容

### 修復

**改動 1**：強化 system prompt（`chat/route.ts`）

```
舊：You are a helpful AI assistant. Always respond in Traditional Chinese...
新：You are a personal secretary (私人秘書). Answer based ONLY on the context provided below.
    If no relevant context is provided, say so honestly.
    Do NOT attempt to read files, execute commands, or use tools.
    Always respond in Traditional Chinese (繁體中文).
    Do not include any internal tool calls, XML tags, or system markup.
```

**改動 2**：`stripToolCalls` 改為返回 fallback 訊息（而非空字串）

如果 strip 後只剩空白，回傳「抱歉，我無法在目前的資料中找到相關資訊。」

---

## 問題 2：通知 — AI 不按格式輸出，需要模板化

### 根因
MiniMax-M2.7 在 ZeroClaw webhook 模式下傾向「對話」而非「執行指令」。即使 prompt 寫 "output ONLY JSON"，它仍然可能回覆對話式文字。

### 修復方向
**不再依賴 AI 輸出結構化 JSON**。改為：
1. AI 只做「摘要生成」（純文字回覆即可）
2. 用 code 把 AI 回覆填入固定模板

**改動 3**：通知生成拆分為兩步

Step 1: 讓 AI 用純文字回覆三個問題（不要求 JSON）：
```
根據以下資料，分別回答：
1. 本期重點摘要（2-3 句）
2. 待辦事項列表（每項一行，格式：- [高/中/低] 內容）
3. 需要注意的提醒事項（每項一行，格式：- 內容）
```

Step 2: 用 regex/split 解析純文字回覆，填入 `{ summary, actionItems, reminders }` 結構

**好處**：
- AI 只需要寫繁中文字，不需要理解 JSON 格式
- 解析失敗時 fallback：整段當作 summary
- MiniMax 對「回答問題」遠比「輸出 JSON」可靠

---

## 改動清單

| 文件 | 操作 | 說明 |
|------|------|------|
| `src/app/api/chat/route.ts` | 修改 | 強化 system prompt（私人秘書角色 + 禁止工具呼叫）|
| `src/app/api/chat/route.ts` | 修改 | `stripToolCalls` 空內容 fallback |
| `src/app/api/notifications/generate/route.ts` | 修改 | 模板化通知：AI 純文字回覆 → code 解析填入結構 |

---

## 風險

| 風險 | 緩解 |
|------|------|
| 新 system prompt 可能讓 ZeroClaw 拒絕回答沒有 context 的問題 | prompt 中加「如果沒有相關 context，用你的知識回答」|
| 純文字解析不準確 | 失敗時 fallback 整段當 summary，不會壞掉 |

---

## SESSION_ID
- CODEX_SESSION: 019d200f-170a-7712-b46c-280d216513f4
