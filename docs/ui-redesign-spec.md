# UI/UX 重構設計方案：ChainThings

**設計時間**：2026-03-11
**目標平台**：Web (Desktop + Mobile 響應式)
**技術棧**：Next.js 16 App Router, React 19, Tailwind CSS 4, shadcn/ui
**目標**：從 MVP 級別 (6.2/10) 提升至生產級別 (8.5+/10)

---

## 1. 現狀分析與問題診斷

### 1.1 現有問題清單

| 問題 | 嚴重度 | 影響範圍 |
|------|--------|----------|
| 側邊欄無 active state，用戶不知道所在頁面 | 高 | 全局 |
| 零手機適配，側邊欄在窄屏完全不可用 | 高 | 全局 |
| 所有樣式內聯硬編碼，無設計令牌統一管理 | 高 | 全局 |
| 無組件抽象複用，每頁重複寫 border/rounded/px-3 | 中 | 全局 |
| 表格（Files）在手機上溢出 | 高 | Files 頁 |
| 按鈕樣式不統一（藍底白字 vs 黑底白字 vs 灰邊框） | 中 | 全局 |
| 無空狀態設計（僅灰色文字） | 低 | Chat/Files/Workflows |
| 無 loading 骨架屏 | 低 | 多頁面 |
| 頁面標題 metadata 仍為 "Create Next App" | 低 | 全局 |
| 無 Items/Meeting Notes 頁面 | 高 | 功能缺失 |

### 1.2 設計目標

**用戶目標**：
- 在任何設備上流暢使用 ChainThings 的全部功能
- 快速定位所在頁面、找到想要的功能入口
- 清晰理解操作狀態（loading / success / error）

**業務目標**：
- 提升產品質感，從原型感升級為可交付的 SaaS 產品
- 建立可擴展的組件體系，降低後續開發成本
- 為未來功能（暗色模式、多語言等）預留擴展空間

---

## 2. 設計系統基礎

### 2.1 色彩方案

使用 shadcn/ui 的 CSS 變量系統，在 `globals.css` 中定義。僅實現亮色主題。

```css
@layer base {
  :root {
    /* 基礎色 */
    --background: 0 0% 100%;          /* #FFFFFF - 頁面背景 */
    --foreground: 240 10% 3.9%;       /* #0A0A0B - 主文字 */

    /* 卡片/面板 */
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;

    /* 彈出層 */
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;

    /* 主色調 - 靛藍色 (從原始 blue-600 演進) */
    --primary: 221 83% 53%;           /* #3B82F6 */
    --primary-foreground: 210 40% 98%;

    /* 次要色 - 淺灰背景按鈕 */
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;

    /* 柔和背景 */
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;

    /* 強調色 - 用於 active state, 選中態 */
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;

    /* 語義色 */
    --destructive: 0 84% 60%;         /* #EF4444 - 錯誤/刪除 */
    --destructive-foreground: 0 0% 98%;

    /* 邊框與輸入框 */
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 221 83% 53%;              /* focus ring = primary */

    /* 圓角 */
    --radius: 0.5rem;

    /* 側邊欄專用 */
    --sidebar-background: 0 0% 98%;
    --sidebar-foreground: 240 5.3% 26.1%;
    --sidebar-primary: 221 83% 53%;
    --sidebar-primary-foreground: 0 0% 98%;
    --sidebar-accent: 240 4.8% 95.9%;
    --sidebar-accent-foreground: 240 5.9% 10%;
    --sidebar-border: 220 13% 91%;
  }
}
```

**語義色使用規則**：

| 顏色 | CSS 變量 | 使用場景 |
|------|----------|----------|
| Primary (靛藍) | `--primary` | CTA 按鈕、導航 active、連結 |
| Success (綠) | 直接用 `green-600` | 狀態 active、保存成功 toast |
| Warning (琥珀) | 直接用 `amber-600` | pending 狀態、注意事項 |
| Destructive (紅) | `--destructive` | 錯誤提示、刪除按鈕 |
| Muted (灰) | `--muted` | 次要文字、禁用態、占位符 |

### 2.2 字體規範

保留現有 Geist 字體系列，但規範使用方式：

```
頁面標題 (h1):    text-2xl  (24px), font-bold,   tracking-tight
區塊標題 (h2):    text-lg   (18px), font-semibold
卡片標題 (h3):    text-base (16px), font-medium
正文:             text-sm   (14px), font-normal,  leading-relaxed
輔助文字:         text-xs   (12px), text-muted-foreground
代碼/等寬:        font-mono, text-xs
```

### 2.3 間距系統

遵循 Tailwind 4px 基線網格：

```
元素內邊距:       p-3 (12px) 或 p-4 (16px)
卡片內邊距:       p-4 (16px) 或 p-5 (20px)
區塊間距:         space-y-4 (16px) 或 space-y-6 (24px)
頁面主區邊距:     p-4 (mobile) / p-6 (tablet) / p-8 (desktop)
列間距:           gap-4 (16px) 或 gap-6 (24px)
```

### 2.4 shadcn/ui 組件清單

以下是本次重構需要安裝的 shadcn/ui 組件：

**必裝（Phase 1）**：

| 組件 | 用途 |
|------|------|
| `button` | 統一所有按鈕樣式 (primary / secondary / destructive / ghost / outline) |
| `input` | 統一所有文字輸入框 |
| `label` | 表單標籤 |
| `card` | Dashboard 卡片、Chat 列表項、Workflow 項、Meeting Note 卡片 |
| `badge` | 工作流狀態標籤 (active/pending/error)、文件類型標籤 |
| `table` | Files 頁表格 |
| `textarea` | Workflow prompt 輸入、Chat 輸入 |
| `separator` | 區塊分隔線 |
| `skeleton` | Loading 骨架屏 |
| `avatar` | 用戶頭像（側邊欄底部） |
| `sheet` | 手機端側邊欄抽屜 |
| `scroll-area` | 聊天訊息滾動區 |
| `tooltip` | 圖標按鈕提示 |
| `sonner` (toast) | 操作成功/失敗反饋 |
| `alert` | 錯誤和提示訊息區塊 |
| `dialog` | 確認刪除等彈窗 |
| `dropdown-menu` | 用戶菜單、行操作菜單 |
| `tabs` | Meeting Note 詳情頁的內容切換 |

**選裝（Phase 2，看需求）**：

| 組件 | 用途 |
|------|------|
| `command` | 全局搜索 (Cmd+K) |
| `breadcrumb` | 頁面路徑提示 |
| `collapsible` | 側邊欄分組折疊 |
| `progress` | 文件上傳進度 |
| `empty-state` | 自定義空狀態組件（非 shadcn 原生，需自建） |

---

## 3. 全局布局重構

### 3.1 Protected Layout - 桌面端

```
+---------------------------------------------------------------+
|  Sidebar (w-64, 固定)           |  Main Content Area          |
|  +---------------------------+  |  +------------------------+ |
|  |  Logo + App Name          |  |  |  Page Header           | |
|  |  "ChainThings"            |  |  |  [Title]    [Actions]  | |
|  +---------------------------+  |  +------------------------+ |
|  |                           |  |                            |
|  |  Navigation               |  |  Page Content              |
|  |  +-----------------------+|  |  (scrollable)              |
|  |  | * Dashboard           ||  |                            |
|  |  | * Chat                ||  |                            |
|  |  | * Files               ||  |                            |
|  |  | * Workflows           ||  |                            |
|  |  | * Meeting Notes       ||  |                            |
|  |  +-----------------------+|  |                            |
|  |                           |  |                            |
|  |  --- separator ---        |  |                            |
|  |                           |  |                            |
|  |  +-----------------------+|  |                            |
|  |  | * Settings            ||  |                            |
|  |  +-----------------------+|  |                            |
|  |                           |  |                            |
|  |  (spacer)                 |  |                            |
|  |                           |  |                            |
|  +---------------------------+  |                            |
|  |  User Footer              |  |                            |
|  |  [Avatar] user@email.com  |  |                            |
|  |  [Sign out dropdown]      |  |                            |
|  +---------------------------+  +----------------------------+
+---------------------------------------------------------------+
```

### 3.2 Protected Layout - 手機端 (< 768px)

```
+-------------------------------+
|  Top Bar                      |
|  [Hamburger]  ChainThings     |
+-------------------------------+
|                               |
|  Page Content                 |
|  (full width, scrollable)     |
|                               |
|                               |
+-------------------------------+

--- 點擊 Hamburger 後 ---

+-------------------------------+
|  Sheet (Overlay from left)    |
|  +-------------------------+  |
|  |  Logo + App Name       [X]|
|  +-------------------------+  |
|  |  Navigation Links        |  |
|  |  (同桌面版)              |  |
|  +-------------------------+  |
|  |  User Footer             |  |
|  +-------------------------+  |
+-------------------------------+
```

### 3.3 組件樹

```
ProtectedLayout
├── Sidebar (桌面端: 固定顯示)
│   ├── SidebarHeader
│   │   └── AppLogo ("ChainThings" + icon)
│   ├── SidebarNav
│   │   ├── NavItem (href="/dashboard", icon=LayoutDashboard, label="Dashboard")
│   │   ├── NavItem (href="/chat", icon=MessageSquare, label="Chat")
│   │   ├── NavItem (href="/files", icon=FolderOpen, label="Files")
│   │   ├── NavItem (href="/workflows", icon=Workflow, label="Workflows")
│   │   ├── NavItem (href="/items", icon=FileText, label="Meeting Notes")
│   │   ├── Separator
│   │   └── NavItem (href="/settings", icon=Settings, label="Settings")
│   └── SidebarFooter
│       ├── Avatar + UserEmail
│       └── DropdownMenu (Sign out)
├── MobileHeader (手機端: 頂部列)
│   ├── HamburgerButton (觸發 Sheet)
│   └── AppLogo (簡化)
├── MobileSidebar (Sheet 組件包裝)
│   └── (同 Sidebar 內容)
└── MainContent
    └── {children}
```

### 3.4 NavItem 組件 - Active State 設計

```typescript
interface NavItemProps {
  href: string
  icon: LucideIcon
  label: string
  isActive: boolean  // 由 usePathname() 判斷
}
```

**視覺狀態**：
- **默認**：`text-muted-foreground hover:bg-accent hover:text-accent-foreground`
- **Active**：`bg-primary/10 text-primary font-medium` + 左側 2px 藍色指示條
- **Hover**：`bg-accent`

---

## 4. 逐頁設計方案

---

### 4.1 Auth 頁面 (Login + Register)

**現狀問題**：功能正常但極簡，無品牌感，無視覺吸引力。

#### 布局

```
+--------------------------------------------------+
|                                                    |
|         +------------------------------+           |
|         |                              |           |
|         |    [ChainThings Logo]        |           |
|         |    "Sign in to your account" |           |
|         |                              |           |
|         |    +----------------------+  |           |
|         |    | Email               |  |           |
|         |    +----------------------+  |           |
|         |    | Password            |  |           |
|         |    +----------------------+  |           |
|         |                              |           |
|         |    [Error Alert]  (條件)     |           |
|         |                              |           |
|         |    [====  Sign in  ====]     |           |
|         |                              |           |
|         |    Don't have an account?    |           |
|         |    Register                  |           |
|         |                              |           |
|         +------------------------------+           |
|                Card (shadow-md)                    |
|                                                    |
|         (底部細字: "Powered by ChainThings")       |
+--------------------------------------------------+
     背景: 微妙漸層或淺灰 bg-muted/50
```

#### 手機版調整

- Card 佔滿寬度，無 shadow，無圓角（或微圓角）
- 內邊距從 p-6 增加到 p-6 + 上方留白減少

#### 組件拆分

```
LoginPage / RegisterPage
├── AuthLayout (共用外層: 置中 + 背景)
│   └── Card
│       ├── CardHeader
│       │   ├── AppLogo
│       │   └── CardDescription ("Sign in to your account")
│       ├── CardContent
│       │   └── AuthForm
│       │       ├── FormField (Label + Input: email)
│       │       ├── FormField (Label + Input: password)
│       │       ├── FormField (Label + Input: username) -- Register only
│       │       ├── Alert (error, 條件渲染)
│       │       └── Button (type=submit, w-full)
│       └── CardFooter
│           └── Link ("Don't have an account? Register")
```

#### 交互細節

| 狀態 | UI 表現 |
|------|---------|
| Idle | 按鈕可點擊，輸入框空白 |
| Submitting | 按鈕 disabled + 左側 Loader2 spinner 圖標旋轉 + 文字 "Signing in..." |
| Error | 表單上方出現 Alert variant="destructive"，紅色背景，帶 AlertCircle 圖標 |
| Success | router.push，不需額外提示 |

#### 關鍵 Props

```typescript
// 可複用的 AuthForm 組件
interface AuthFormProps {
  mode: 'login' | 'register'
  onSubmit: (data: AuthFormData) => Promise<void>
  isLoading: boolean
  error: string | null
}

interface AuthFormData {
  email: string
  password: string
  username?: string  // register only
}
```

---

### 4.2 Dashboard 頁面

**現狀問題**：僅 3 個外部連結卡片，資訊密度低，無實際數據展示。

#### 布局

```
+--------------------------------------------------+
|  Page Header                                      |
|  "Dashboard"                                      |
|  "Welcome back, {username}"  (text-muted)         |
+--------------------------------------------------+
|                                                    |
|  統計概覽 (grid: 4 cols desktop, 2 cols mobile)    |
|  +----------+ +----------+ +----------+ +--------+|
|  | Chats    | | Files    | | Workflows| | Notes  ||
|  | 12       | | 34       | | 5        | | 8      ||
|  | +3 today | | 2.1 MB   | | 3 active | | +2 new ||
|  +----------+ +----------+ +----------+ +--------+|
|                                                    |
|  快速操作 (Quick Actions)                          |
|  +--------------------------------------------------+
|  | [+ New Chat]  [Upload File]  [Create Workflow] |
|  +--------------------------------------------------+
|                                                    |
|  外部服務 (External Services)                      |
|  +----------+ +----------+ +----------+            |
|  | Supabase | | n8n      | | OpenClaw |            |
|  | Studio   | | Workflows| | AI Agent |            |
|  | [Open]   | | [Open]   | | [Open]   |            |
|  +----------+ +----------+ +----------+            |
|                                                    |
+--------------------------------------------------+
```

#### 手機版

- 統計概覽：2 列 grid
- 快速操作：垂直堆疊或水平滾動
- 外部服務：單列

#### 組件拆分

```
DashboardPage
├── PageHeader
│   ├── h1 "Dashboard"
│   └── p (welcome message)
├── StatsGrid
│   ├── StatCard (icon=MessageSquare, label="Chats", value=12, change="+3 today")
│   ├── StatCard (icon=FolderOpen, label="Files", value=34, change="2.1 MB total")
│   ├── StatCard (icon=Workflow, label="Workflows", value=5, change="3 active")
│   └── StatCard (icon=FileText, label="Notes", value=8, change="+2 this week")
├── QuickActions
│   ├── Button (variant=outline, icon=Plus, "New Chat", href=/chat/new)
│   ├── Button (variant=outline, icon=Upload, "Upload File", onClick)
│   └── Button (variant=outline, icon=Zap, "Create Workflow", href=/workflows)
└── ExternalServices
    ├── ServiceCard (name="Supabase Studio", desc, url, icon)
    ├── ServiceCard (name="n8n", desc, url, icon)
    └── ServiceCard (name="OpenClaw", desc, url, icon)
```

#### 關鍵組件 Props

```typescript
interface StatCardProps {
  icon: LucideIcon
  label: string
  value: number | string
  change?: string
  href?: string  // 點擊跳轉
}

interface ServiceCardProps {
  name: string
  description: string
  url: string
  icon?: LucideIcon
}
```

---

### 4.3 Chat List 頁面

**現狀問題**：列表功能基本，無刪除、無搜索、空狀態太簡陋。

#### 布局

```
+--------------------------------------------------+
|  Page Header                                      |
|  "Chat"                        [+ New conversation]|
+--------------------------------------------------+
|                                                    |
|  搜索框 (可選，Phase 2)                             |
|  +----------------------------------------------+ |
|  | Search conversations...                       | |
|  +----------------------------------------------+ |
|                                                    |
|  對話列表                                          |
|  +----------------------------------------------+ |
|  | [MessageSquare icon]                      ... | |
|  | "Project planning discussion"                 | |
|  | Last message preview text...    3 hours ago   | |
|  +----------------------------------------------+ |
|  | [MessageSquare icon]                      ... | |
|  | "API integration help"                        | |
|  | Last message preview text...    Yesterday     | |
|  +----------------------------------------------+ |
|  | ...                                           | |
|  +----------------------------------------------+ |
|                                                    |
|  --- 空狀態 ---                                    |
|  +----------------------------------------------+ |
|  |     [MessageSquare large icon]                | |
|  |     "No conversations yet"                    | |
|  |     "Start your first AI chat"                | |
|  |     [+ New conversation]                      | |
|  +----------------------------------------------+ |
+--------------------------------------------------+
```

#### 組件拆分

```
ChatListPage
├── PageHeader
│   ├── h1 "Chat"
│   └── Button (variant=default, icon=Plus, "New conversation")
├── ConversationList
│   └── ConversationCard[] (map)
│       ├── Icon (MessageSquare)
│       ├── Title
│       ├── Timestamp (relative: "3 hours ago")
│       └── DropdownMenu (三點 ... 按鈕)
│           ├── MenuItem "Rename"
│           └── MenuItem "Delete" (destructive)
└── EmptyState (條件渲染)
    ├── Icon
    ├── Title
    ├── Description
    └── CTA Button
```

#### 關鍵 Props

```typescript
interface ConversationCardProps {
  id: string
  title: string
  updatedAt: string       // ISO date
  messagePreview?: string // 最後一條訊息摘要
  onDelete?: (id: string) => void
  onRename?: (id: string, newTitle: string) => void
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: {
    label: string
    href?: string
    onClick?: () => void
  }
}
```

---

### 4.4 Chat/[id] 頁面 (對話詳情)

**現狀**：7/10 質量，是最好的頁面。重構重點在於與整體設計語言統一。

#### 布局

```
+--------------------------------------------------+
|  Chat Header (sticky top)                         |
|  [<- Back]  "Conversation Title"      [...]       |
+--------------------------------------------------+
|                                                    |
|  Messages Area (ScrollArea, flex-1)               |
|                                                    |
|  +----------------------------------------------+ |
|  |  [AI Avatar]                                  | |
|  |  AI Message bubble                            | |
|  |  "Here is the analysis you requested..."      | |
|  |                                   10:30 AM    | |
|  +----------------------------------------------+ |
|  |                                               | |
|  |                    [User Avatar]              | |
|  |              User Message bubble              | |
|  |        "Can you explain this further?"        | |
|  |  10:32 AM                                     | |
|  +----------------------------------------------+ |
|                                                    |
+--------------------------------------------------+
|  Input Area (sticky bottom)                       |
|  +------------------------------------------+    |
|  | Type your message...              [Send] |    |
|  +------------------------------------------+    |
+--------------------------------------------------+
```

#### 手機版

- 相同布局，全寬
- Back 按鈕顯示（返回 Chat List）
- 輸入框固定底部

#### 組件拆分

```
ChatDetailPage
├── ChatHeader (sticky)
│   ├── Button (variant=ghost, icon=ArrowLeft, 手機顯示)
│   ├── ConversationTitle
│   └── DropdownMenu (...)
├── MessageList (ScrollArea)
│   └── MessageBubble[] (map)
│       ├── Avatar (AI or User)
│       ├── MessageContent (支持 markdown)
│       └── Timestamp
└── ChatInput (sticky bottom)
    ├── Textarea (自動增高，max 4 行)
    └── Button (icon=Send, disabled when empty)
```

#### 關鍵 Props

```typescript
interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  isStreaming?: boolean   // AI 正在回覆中
}

interface ChatInputProps {
  onSend: (message: string) => void
  isDisabled: boolean     // AI 正在回覆時禁用
  placeholder?: string
}
```

---

### 4.5 Files 頁面

**現狀問題**：原始 HTML table，手機溢出，無檔案操作（下載/刪除），無拖放上傳。

#### 桌面端布局

```
+--------------------------------------------------+
|  Page Header                                      |
|  "Files"                          [Upload file]   |
+--------------------------------------------------+
|                                                    |
|  檔案表格 (shadcn Table)                           |
|  +----------------------------------------------+ |
|  | Name          | Type     | Size   | Uploaded | |
|  |---------------|----------|--------|----------| |
|  | report.pdf    | PDF      | 2.1 MB | Mar 10   | |
|  | notes.md      | Markdown | 4.2 KB | Mar 9    | |
|  | data.csv      | CSV      | 128 KB | Mar 8    | |
|  +----------------------------------------------+ |
|                                                    |
|  --- 空狀態 ---                                    |
|  +----------------------------------------------+ |
|  |         [Upload icon]                         | |
|  |     "No files uploaded yet"                   | |
|  |     "Drag and drop or click to upload"        | |
|  |     [Upload file]                             | |
|  +----------------------------------------------+ |
+--------------------------------------------------+
```

#### 手機版 - 改為卡片列表

```
+-------------------------------+
|  "Files"          [Upload]    |
+-------------------------------+
|                               |
|  +---------------------------+|
|  | report.pdf                ||
|  | PDF - 2.1 MB - Mar 10    ||
|  |                    [...]  ||
|  +---------------------------+|
|  | notes.md                  ||
|  | Markdown - 4.2 KB - Mar 9||
|  |                    [...]  ||
|  +---------------------------+|
+-------------------------------+
```

#### 組件拆分

```
FilesPage
├── PageHeader
│   ├── h1 "Files"
│   └── UploadButton
│       ├── Button (variant=default, icon=Upload)
│       └── hidden input[type=file]
├── FileTable (桌面端, hidden on mobile)
│   ├── TableHeader (Name / Type / Size / Uploaded / Actions)
│   └── TableRow[] (map)
│       ├── FileName (icon by type + name)
│       ├── Badge (file type)
│       ├── Size (formatted)
│       ├── Date (relative)
│       └── DropdownMenu (Download / Delete)
├── FileCardList (手機端, hidden on desktop)
│   └── FileCard[] (map)
│       ├── FileName
│       ├── MetaInfo (type + size + date)
│       └── DropdownMenu
├── UploadDropZone (拖放區域, 覆蓋整個內容區)
│   └── "Drop files here to upload"
└── EmptyState (條件渲染)
```

#### 關鍵 Props

```typescript
interface FileRowProps {
  id: string
  filename: string
  contentType: string | null
  sizeBytes: number | null
  createdAt: string
  onDownload: (id: string) => void
  onDelete: (id: string) => void
}

// 文件類型圖標映射
function getFileIcon(contentType: string | null): LucideIcon {
  // application/pdf -> FileText
  // image/* -> Image
  // text/* -> FileCode
  // default -> File
}
```

#### 交互狀態

| 狀態 | UI 表現 |
|------|---------|
| Uploading | Upload 按鈕 disabled + spinner + "Uploading..." |
| Upload Error | Sonner toast (destructive) |
| Upload Success | Sonner toast (success) + 列表刷新 |
| Deleting | Dialog 確認 -> toast 反饋 |
| Loading | Skeleton rows (3-5 行) |
| Empty | EmptyState 組件 |
| Drag Over | 整個內容區顯示虛線邊框 + 藍色背景 overlay |

---

### 4.6 Workflows 頁面

**現狀問題**：功能完整但視覺粗糙，狀態標籤用純文字上色，生成區塊和列表沒有視覺分離。

#### 布局

```
+--------------------------------------------------+
|  Page Header                                      |
|  "Workflows"                                      |
+--------------------------------------------------+
|                                                    |
|  生成區 (Card, 帶背景色突出)                        |
|  +----------------------------------------------+ |
|  | [Zap icon] Create a new workflow with AI      | |
|  |                                               | |
|  | +------------------------------------------+ | |
|  | | Describe the workflow you want...         | | |
|  | |                                           | | |
|  | +------------------------------------------+ | |
|  |                         [Generate workflow]   | |
|  +----------------------------------------------+ |
|                                                    |
|  工作流列表                                        |
|  +----------------------------------------------+ |
|  | "Email notification on webhook"               | |
|  | "A webhook that receives..."    [Active]      | |
|  | Mar 10                     [Open in n8n]      | |
|  +----------------------------------------------+ |
|  | "Data sync pipeline"                          | |
|  | "Sync data from..."          [Pending]        | |
|  | Mar 8                                         | |
|  +----------------------------------------------+ |
+--------------------------------------------------+
```

#### 組件拆分

```
WorkflowsPage
├── PageHeader
│   └── h1 "Workflows"
├── WorkflowGenerator (Card, variant with bg-muted/50)
│   ├── CardHeader
│   │   ├── Icon (Zap)
│   │   └── Title "Create a new workflow with AI"
│   ├── CardContent
│   │   └── Textarea (prompt)
│   └── CardFooter
│       ├── Alert (error, 條件渲染)
│       └── Button ("Generate workflow" / "Generating...")
├── WorkflowList
│   └── WorkflowCard[] (map)
│       ├── CardHeader
│       │   ├── Title (workflow name)
│       │   └── Badge (status: active=green / pending=yellow / generating=blue / error=red)
│       ├── CardContent
│       │   └── Description
│       └── CardFooter
│           ├── Timestamp
│           └── Button (variant=link, "Open in n8n", external)
└── EmptyState (if no workflows & no generator focus)
```

#### Badge 狀態映射

```typescript
const statusConfig: Record<string, { variant: string; label: string }> = {
  active:     { variant: 'default',     label: 'Active' },      // 綠色背景
  pending:    { variant: 'secondary',   label: 'Pending' },     // 灰色背景
  generating: { variant: 'outline',     label: 'Generating' },  // 帶 spinner
  error:      { variant: 'destructive', label: 'Error' },       // 紅色背景
}
```

---

### 4.7 Settings 頁面

**現狀**：8/10 質量，結構最好。重構重點：用 shadcn 組件替換原始 HTML，統一視覺。

#### 布局

```
+--------------------------------------------------+
|  Page Header                                      |
|  "Settings"                                       |
+--------------------------------------------------+
|                                                    |
|  Integrations Section                             |
|                                                    |
|  Hedy.ai (Card)                                   |
|  +----------------------------------------------+ |
|  |  [Hedy icon]  Hedy.ai              [Remove]  | |
|  |  "Voice-to-notes meeting integration"         | |
|  |  ------------------------------------------- | |
|  |                                               | |
|  |  Step 1: API Key                              | |
|  |  +------------------------------+ [Save]     | |
|  |  | ****************************  |            | |
|  |  +------------------------------+             | |
|  |                                               | |
|  |  Step 2: Enable Webhook Workflow              | |
|  |  "Creates an n8n workflow..."                 | |
|  |  [Enable Hedy Integration] or [Active badge]  | |
|  |                                               | |
|  |  Webhook URL (條件顯示)                        | |
|  |  +------------------------------+ [Copy]     | |
|  |  | https://...webhook/hedy-...   |            | |
|  |  +------------------------------+             | |
|  +----------------------------------------------+ |
|                                                    |
+--------------------------------------------------+
```

#### 組件拆分

```
SettingsPage
├── PageHeader
│   └── h1 "Settings"
├── Alert (success/error message, 條件渲染)
├── HedyIntegrationCard (Card)
│   ├── CardHeader
│   │   ├── IntegrationHeader (icon + title + description)
│   │   └── Button (variant=ghost, size=sm, "Remove", destructive text)
│   ├── Separator
│   └── CardContent
│       ├── ApiKeyStep
│       │   ├── Label "1. Hedy API Key"
│       │   ├── InputGroup
│       │   │   ├── Input (type=password)
│       │   │   └── Button ("Save")
│       ├── WebhookStep (條件渲染: hedyIntegration exists)
│       │   ├── Label "2. Enable Webhook Workflow"
│       │   ├── Description (text-muted)
│       │   └── Button or Badge (根據 hasWorkflow)
│       └── WebhookUrl (條件渲染: webhookUrl exists)
│           ├── Label "Webhook URL"
│           ├── CodeBlock + CopyButton
│           └── HelpText
└── OtherIntegrations (Card, 條件渲染)
    └── IntegrationRow[] (map)
```

#### 交互改進

- 用 `Sonner` toast 替代頁面內 Alert 做成功/錯誤反饋
- 刪除確認改用 `Dialog` 而非 `window.confirm()`
- Copy 按鈕點擊後短暫顯示 "Copied!" (用 tooltip 或 icon 變化)

---

### 4.8 Items / Meeting Notes 頁面 (新增)

#### 4.8.1 列表頁 `/items`

**用途**：顯示從 Hedy.ai webhook 接收的會議筆記，按日期分組。

```
+--------------------------------------------------+
|  Page Header                                      |
|  "Meeting Notes"                   [Filter/Sort]  |
+--------------------------------------------------+
|                                                    |
|  Today                                             |
|  +----------------------------------------------+ |
|  | Card                                          | |
|  | "Weekly Product Standup"                      | |
|  | "Discussed roadmap priorities and Q2..."      | |
|  |                                               | |
|  | [Users icon] 5 participants    [Clock] 45min  | |
|  | 10:30 AM                                      | |
|  +----------------------------------------------+ |
|                                                    |
|  Yesterday                                         |
|  +----------------------------------------------+ |
|  | "Design Review: Mobile App"                   | |
|  | "Reviewed new wireframes for the..."          | |
|  |                                               | |
|  | [Users icon] 3 participants    [Clock] 30min  | |
|  | 2:00 PM                                       | |
|  +----------------------------------------------+ |
|  +----------------------------------------------+ |
|  | "Engineering Retro"                           | |
|  | "Sprint retrospective covering..."            | |
|  |                                               | |
|  | [Users icon] 8 participants    [Clock] 60min  | |
|  | 11:00 AM                                      | |
|  +----------------------------------------------+ |
|                                                    |
|  March 8, 2026                                     |
|  +----------------------------------------------+ |
|  | ...                                           | |
|  +----------------------------------------------+ |
|                                                    |
|  --- 空狀態 ---                                    |
|  +----------------------------------------------+ |
|  |     [FileText large icon]                     | |
|  |     "No meeting notes yet"                    | |
|  |     "Connect Hedy.ai in Settings to"          | |
|  |     "automatically capture meeting notes"     | |
|  |     [Go to Settings]                          | |
|  +----------------------------------------------+ |
+--------------------------------------------------+
```

#### 手機版

- 卡片全寬，間距縮小
- 日期分組標題 sticky

#### 組件拆分

```
ItemsListPage
├── PageHeader
│   ├── h1 "Meeting Notes"
│   └── SortDropdown (最新優先 / 最舊優先)
├── DateGroupedList
│   └── DateGroup[] (map by date)
│       ├── DateLabel ("Today" / "Yesterday" / "March 8, 2026")
│       └── MeetingNoteCard[] (map)
│           ├── CardHeader
│           │   └── Title (meeting title, clickable -> detail)
│           ├── CardContent
│           │   └── Summary (2 行截斷, text-muted-foreground)
│           └── CardFooter
│               ├── MetaItem (icon=Users, "{n} participants")
│               ├── MetaItem (icon=Clock, "{duration}")
│               └── Timestamp (time only: "10:30 AM")
├── EmptyState (條件渲染)
│   ├── Icon (FileText)
│   ├── Title
│   ├── Description
│   └── Button ("Go to Settings", href=/settings)
└── Skeleton (loading 狀態)
    └── SkeletonCard[] (3-4 個)
```

#### 關鍵 Props

```typescript
interface MeetingNoteCardProps {
  id: string
  title: string
  summary: string          // 截斷至 2 行
  participantCount: number
  duration?: string        // "45 min"
  meetingDate: string      // ISO date
  onClick: () => void      // navigate to detail
}

interface DateGroupProps {
  date: string             // "Today" | "Yesterday" | formatted date
  children: React.ReactNode
}
```

#### 4.8.2 詳情頁 `/items/[id]`

**用途**：查看完整會議筆記內容、待辦事項、重點標記、逐字稿。

```
+--------------------------------------------------+
|  Page Header                                      |
|  [<- Back to Notes]                               |
|  "Weekly Product Standup"                         |
|  Mar 11, 2026 - 10:30 AM - 45 min               |
|  [Users] Alice, Bob, Charlie, +2 more             |
+--------------------------------------------------+
|                                                    |
|  Tabs: [Summary] [Action Items] [Transcript]      |
|                                                    |
|  === Summary Tab ===                               |
|  +----------------------------------------------+ |
|  |  Key Points (Card)                            | |
|  |  +------------------------------------------+| |
|  |  | * Decided to prioritize feature X for Q2  || |
|  |  | * Budget approved for new hires           || |
|  |  | * Design review scheduled for Friday      || |
|  |  +------------------------------------------+| |
|  +----------------------------------------------+ |
|  |                                               | |
|  |  Full Summary                                 | |
|  |  "The team discussed the product roadmap..." | |
|  |  (長文本, prose 排版)                          | |
|  +----------------------------------------------+ |
|                                                    |
|  === Action Items Tab ===                          |
|  +----------------------------------------------+ |
|  | [ ] Alice: Prepare Q2 feature spec by Mar 15 | |
|  | [x] Bob: Update design mockups (completed)   | |
|  | [ ] Charlie: Schedule stakeholder meeting     | |
|  +----------------------------------------------+ |
|                                                    |
|  === Transcript Tab ===                            |
|  +----------------------------------------------+ |
|  | [10:30] Alice: "Let's start with the..."     | |
|  | [10:31] Bob: "I have an update on..."         | |
|  | [10:33] Charlie: "Regarding the budget..."    | |
|  | ...                                           | |
|  +----------------------------------------------+ |
|                                                    |
+--------------------------------------------------+
```

#### 手機版

- Tabs 改為全寬 segmented control 風格
- 返回按鈕更明顯
- 參與者列表折疊顯示

#### 組件拆分

```
ItemDetailPage
├── PageHeader
│   ├── BackButton (icon=ArrowLeft, "Back to Notes", href=/items)
│   ├── h1 (meeting title)
│   ├── MetaRow
│   │   ├── DateDisplay (formatted date + time)
│   │   ├── Duration (icon=Clock, "45 min")
│   │   └── ParticipantList
│   │       ├── AvatarGroup (最多顯示 3 個)
│   │       └── OverflowCount ("+2 more")
├── Tabs
│   ├── TabTrigger "Summary"
│   ├── TabTrigger "Action Items"
│   └── TabTrigger "Transcript"
├── TabContent: Summary
│   ├── KeyPointsCard
│   │   └── BulletList (key points)
│   └── FullSummary (prose 排版)
├── TabContent: ActionItems
│   └── ActionItemList
│       └── ActionItem[] (map)
│           ├── Checkbox (completed state)
│           ├── Assignee (bold)
│           ├── Description
│           └── DueDate (optional)
└── TabContent: Transcript
    └── TranscriptView (ScrollArea)
        └── TranscriptEntry[] (map)
            ├── Timestamp ("[10:30]")
            ├── Speaker (bold, colored)
            └── Text
```

#### 關鍵 Props

```typescript
interface MeetingNoteDetail {
  id: string
  title: string
  meetingDate: string
  duration?: string
  participants: Participant[]
  keyPoints: string[]
  summary: string
  actionItems: ActionItem[]
  transcript: TranscriptEntry[]
}

interface Participant {
  name: string
  email?: string
}

interface ActionItem {
  id: string
  assignee: string
  description: string
  completed: boolean
  dueDate?: string
}

interface TranscriptEntry {
  timestamp: string        // "10:30"
  speaker: string
  text: string
}

// Detail page props
interface ItemDetailPageProps {
  params: { id: string }
}
```

#### 交互狀態

| 狀態 | UI 表現 |
|------|---------|
| Loading | Skeleton: 頁頭骨架 + Tab 區域骨架 |
| Loaded | 完整內容顯示 |
| Not Found | 404 EmptyState + "Back to Notes" 按鈕 |
| Action Item Toggle | 點擊 checkbox -> 樂觀更新 + API call |

---

## 5. 可複用組件清單

### 5.1 基礎佈局組件 (自建)

| 組件 | 位置 | 用途 |
|------|------|------|
| `PageHeader` | `@/components/page-header` | 所有頁面標題 + 右側操作區 |
| `EmptyState` | `@/components/empty-state` | 所有列表的空狀態 |
| `AppSidebar` | `@/components/app-sidebar` | 全局側邊欄 |
| `NavItem` | `@/components/nav-item` | 側邊欄導航項 |
| `MobileHeader` | `@/components/mobile-header` | 手機端頂部列 |

### 5.2 組件 Props 定義

```typescript
// --- PageHeader ---
interface PageHeaderProps {
  title: string
  description?: string
  children?: React.ReactNode  // 右側操作區 slot
}

// --- EmptyState ---
interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: {
    label: string
    href?: string
    onClick?: () => void
    variant?: 'default' | 'outline'
  }
}

// --- AppSidebar ---
interface AppSidebarProps {
  user: {
    email: string
    displayName?: string
  }
}

// --- NavItem ---
interface NavItemProps {
  href: string
  icon: LucideIcon
  label: string
  isActive: boolean
}
```

### 5.3 業務組件 (自建)

| 組件 | 用途 | 複用位置 |
|------|------|----------|
| `StatCard` | 統計數字卡片 | Dashboard |
| `ServiceCard` | 外部服務卡片 | Dashboard |
| `ConversationCard` | 對話列表項 | Chat List |
| `MessageBubble` | 聊天訊息氣泡 | Chat Detail |
| `ChatInput` | 聊天輸入區 | Chat Detail |
| `FileRow` / `FileCard` | 文件列表項 | Files |
| `WorkflowCard` | 工作流列表項 | Workflows |
| `WorkflowGenerator` | 工作流生成器 | Workflows |
| `MeetingNoteCard` | 會議筆記卡片 | Items List |
| `ActionItem` | 待辦事項項 | Items Detail |
| `TranscriptEntry` | 逐字稿項 | Items Detail |
| `HedyIntegrationCard` | Hedy 整合設定 | Settings |

---

## 6. 交互流程總覽

### 6.1 全局導航流程

```
用戶登入
  |
  v
Dashboard -----> Chat List -----> Chat Detail
  |                                     |
  |               (back)  <-------------|
  |
  +-----> Files
  |
  +-----> Workflows
  |
  +-----> Meeting Notes -----> Note Detail
  |                                |
  |               (back)  <--------|
  |
  +-----> Settings
  |
  v
Sign Out -> Login
```

### 6.2 通用互動模式

**列表頁模式** (Chat / Files / Workflows / Items)：

```
進入頁面
  |
  v
Loading? ----yes----> 顯示 Skeleton (3-5 項)
  |
  no
  |
  v
有數據? ----no-----> 顯示 EmptyState (icon + text + CTA)
  |
  yes
  |
  v
顯示列表
  |
  v
用戶操作 (新增/刪除/點擊)
  |
  +-- 新增: 跳轉或彈窗 -> 成功 toast -> 刷新列表
  +-- 刪除: Dialog 確認 -> API call -> 成功 toast -> 刷新列表
  +-- 點擊: 跳轉至詳情頁
```

**表單提交模式** (Login / Register / Workflow Generate / Settings)：

```
用戶填寫表單
  |
  v
點擊提交
  |
  v
按鈕狀態: disabled + spinner + "xxx中..."
  |
  v
API 回應
  |
  +-- 成功: Toast "操作成功" + 頁面刷新或跳轉
  +-- 失敗: Toast (destructive) 或 Alert 顯示錯誤 + 按鈕恢復可點擊
```

---

## 7. 響應式設計規範

### 7.1 Breakpoint 策略

| 屏幕 | Tailwind 前綴 | 寬度 | 布局策略 |
|------|--------------|------|----------|
| Mobile | (default) | < 768px | 單列，漢堡菜單，卡片全寬 |
| Tablet | `md:` | 768px - 1023px | 側邊欄可折疊，2 列 grid |
| Desktop | `lg:` | >= 1024px | 固定側邊欄，多列 grid |

### 7.2 核心響應式規則

```
/* 側邊欄 */
Mobile:  hidden (改用 Sheet)
Desktop: w-64, fixed left

/* 主內容區 */
Mobile:  p-4, w-full
Desktop: p-6 lg:p-8, ml-64

/* 統計卡片 Grid */
Mobile:  grid-cols-2
Desktop: grid-cols-4

/* 表格 (Files) */
Mobile:  hidden (改用 CardList)
Desktop: Table 顯示

/* Dashboard 服務卡片 */
Mobile:  grid-cols-1
Desktop: grid-cols-3
```

### 7.3 手機端關鍵適配

| 頁面 | 適配策略 |
|------|----------|
| Auth | Card 無 shadow，全寬邊距 |
| Dashboard | 2 列統計 -> 快速操作水平滾動 -> 單列服務卡片 |
| Chat List | 全寬卡片，間距縮小 |
| Chat Detail | 全屏聊天，底部固定輸入框，頂部 sticky header + back 按鈕 |
| Files | Table 切換為 Card list |
| Workflows | 生成區域 textarea 全寬 |
| Items | 全寬卡片，日期標題 sticky |
| Item Detail | Tabs 全寬，content 全寬 |
| Settings | Card 全寬 |

---

## 8. 無障礙 (A11y) 規範

### 8.1 全局規則

| 實踐 | 實施方式 |
|------|----------|
| 語義化 HTML | 使用 `<nav>`, `<main>`, `<aside>`, `<header>`, `<footer>` |
| 鍵盤導航 | 所有互動元素可 Tab 到達，Enter/Space 觸發 |
| Focus 可見 | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| ARIA 標籤 | 圖標按鈕必須有 `aria-label`，如 hamburger: `aria-label="Toggle navigation"` |
| 表單關聯 | 所有 `<input>` 必須有對應 `<label>` (shadcn Label 組件自動處理) |
| 錯誤通知 | 使用 `role="alert"` + `aria-live="polite"` |
| 頁面標題 | 每頁設置獨立的 `<title>` via Next.js metadata |
| 跳過導航 | 主內容區添加 `<a href="#main" class="sr-only focus:not-sr-only">Skip to content</a>` |

### 8.2 組件級 A11y

```html
<!-- 側邊欄 -->
<aside aria-label="Main navigation">
  <nav>
    <a href="/dashboard" aria-current="page">Dashboard</a>
    <!-- aria-current="page" 標記當前頁面 -->
  </nav>
</aside>

<!-- 手機端漢堡按鈕 -->
<button aria-label="Toggle navigation" aria-expanded="false">
  <Menu />
</button>

<!-- 文件上傳 -->
<label>
  <span class="sr-only">Upload file</span>
  <input type="file" class="hidden" />
</label>

<!-- 聊天輸入 -->
<textarea
  aria-label="Type your message"
  placeholder="Type your message..."
/>

<!-- 狀態 Badge -->
<span role="status" aria-label="Workflow status: active">Active</span>
```

---

## 9. 文件結構規劃

重構後建議的目錄結構：

```
src/
├── app/
│   ├── layout.tsx                    # Root layout (fonts, metadata)
│   ├── globals.css                   # Design tokens + shadcn theme
│   ├── (auth)/
│   │   ├── layout.tsx                # Auth layout (centered card)
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   └── (protected)/
│       ├── layout.tsx                # Sidebar + main content layout
│       ├── dashboard/page.tsx
│       ├── chat/
│       │   ├── page.tsx              # Chat list
│       │   ├── new/page.tsx          # New chat
│       │   └── [id]/page.tsx         # Chat detail
│       ├── files/page.tsx
│       ├── workflows/page.tsx
│       ├── items/
│       │   ├── page.tsx              # Meeting notes list
│       │   └── [id]/page.tsx         # Meeting note detail
│       └── settings/page.tsx
├── components/
│   ├── ui/                           # shadcn/ui 組件 (自動生成)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── badge.tsx
│   │   ├── table.tsx
│   │   ├── textarea.tsx
│   │   ├── separator.tsx
│   │   ├── skeleton.tsx
│   │   ├── avatar.tsx
│   │   ├── sheet.tsx
│   │   ├── scroll-area.tsx
│   │   ├── tooltip.tsx
│   │   ├── sonner.tsx
│   │   ├── alert.tsx
│   │   ├── dialog.tsx
│   │   ├── dropdown-menu.tsx
│   │   └── tabs.tsx
│   ├── layout/                       # 佈局組件
│   │   ├── app-sidebar.tsx
│   │   ├── nav-item.tsx
│   │   ├── mobile-header.tsx
│   │   └── mobile-sidebar.tsx
│   ├── shared/                       # 共用業務組件
│   │   ├── page-header.tsx
│   │   ├── empty-state.tsx
│   │   └── stat-card.tsx
│   ├── chat/                         # Chat 專用組件
│   │   ├── conversation-card.tsx
│   │   ├── message-bubble.tsx
│   │   └── chat-input.tsx
│   ├── files/                        # Files 專用組件
│   │   ├── file-table.tsx
│   │   ├── file-card.tsx
│   │   └── upload-button.tsx
│   ├── workflows/                    # Workflows 專用組件
│   │   ├── workflow-card.tsx
│   │   └── workflow-generator.tsx
│   ├── items/                        # Items 專用組件
│   │   ├── meeting-note-card.tsx
│   │   ├── action-item.tsx
│   │   └── transcript-entry.tsx
│   └── settings/                     # Settings 專用組件
│       └── hedy-integration-card.tsx
└── lib/
    ├── supabase/
    │   ├── client.ts
    │   └── server.ts
    └── utils.ts                      # cn() helper (shadcn 標準)
```

---

## 10. 實施計劃

### Phase 1: 基礎設施 (建議 1-2 天)

1. 安裝 shadcn/ui 並配置 (`npx shadcn@latest init`)
2. 設定 `globals.css` 中的設計令牌
3. 安裝所有必需 shadcn 組件
4. 建立 `PageHeader`, `EmptyState` 共用組件
5. 重構 `ProtectedLayout` (AppSidebar + MobileHeader + Sheet)
6. 修復 Root metadata (title + description)

### Phase 2: 頁面重構 (建議 2-3 天)

按影響順序：
1. Auth 頁面 (Login + Register) -- 最簡單，快速見效
2. Dashboard -- 增加統計卡片
3. Files -- Table 重構 + 手機卡片
4. Workflows -- 生成區卡片化 + Badge
5. Chat List -- 卡片化 + EmptyState
6. Chat Detail -- 統一樣式語言
7. Settings -- shadcn 組件替換 + Dialog

### Phase 3: 新增功能 (建議 1-2 天)

1. Items API route (`/api/items`)
2. Items 列表頁
3. Items 詳情頁

### Phase 4: 打磨 (建議 1 天)

1. Loading skeleton 全頁面覆蓋
2. Toast 反饋統一
3. 響應式測試與修復
4. A11y 審查

---

## 11. 開發交付檢查清單

- [ ] shadcn/ui 已初始化，所有必需組件已安裝
- [ ] 設計令牌已定義在 globals.css
- [ ] ProtectedLayout 已重構 (sidebar active state + mobile sheet)
- [ ] PageHeader 組件已建立並在所有頁面使用
- [ ] EmptyState 組件已建立並在所有列表頁使用
- [ ] 所有按鈕統一使用 shadcn Button (不再有內聯 className 按鈕)
- [ ] 所有輸入框統一使用 shadcn Input
- [ ] Files 頁桌面用 Table，手機用 Card list
- [ ] Workflow 狀態使用 Badge 組件
- [ ] Chat Detail 訊息區使用 ScrollArea
- [ ] Items 列表頁已實現 (按日期分組)
- [ ] Items 詳情頁已實現 (Tabs: Summary / Action Items / Transcript)
- [ ] 所有刪除操作使用 Dialog 確認
- [ ] 所有異步操作有 loading 狀態 (button spinner 或 skeleton)
- [ ] 操作反饋統一使用 Sonner toast
- [ ] 手機端全部頁面可正常使用
- [ ] Root metadata 已更新 (title: "ChainThings")
- [ ] A11y: 所有圖標按鈕有 aria-label
- [ ] A11y: 所有表單 input 有對應 label
- [ ] A11y: 鍵盤可完整導航全部功能
