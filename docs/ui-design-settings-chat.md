# UI/UX Design Specification: Settings Page Refactor + Chat Page Upgrade

**Design Date**: 2026-03-17
**Target Platform**: Web (responsive, mobile-first)
**Tech Stack**: Next.js 16 (App Router), React 19, Tailwind CSS 4, lucide-react
**UI Library**: Custom components (Card, Button, Input, Dialog, Separator, Badge, Avatar) -- no external UI library

---

## Part A: Settings Page Refactor

### 1. Design Goals

**User Goals**:
- Quickly locate and modify a specific setting category
- Understand the current state of all configurations at a glance
- Save changes with clear feedback

**Business Goals**:
- Consolidate all user/tenant settings into a single discoverable location
- Reduce support requests by making configuration self-service
- Prepare extensible layout for future setting categories

---

### 2. Page Structure Design

#### 2.1 Desktop Layout (>= 1024px)

```
+---------------------------------------------------------------+
|  AppSidebar (existing, 256px fixed)                           |
+---------------------------------------------------------------+
|                                                               |
|  PageHeader: "Settings"                                       |
|  "Manage your account, preferences, and integrations"         |
|                                                               |
|  +----------------+  +--------------------------------------+ |
|  | Category Nav   |  | Content Panel                        | |
|  |                |  |                                       | |
|  | > Profile   *  |  | [Card: Section Title + Description]  | |
|  |   Notifications |  |                                       | |
|  |   Appearance   |  |  +----------------------------------+ | |
|  |   AI Assistant |  |  |  Form fields / Controls          | | |
|  |   Integrations |  |  |                                   | | |
|  |                |  |  +----------------------------------+ | |
|  |                |  |                                       | |
|  |                |  | [Save Button] (if not auto-save)     | |
|  +----------------+  +--------------------------------------+ |
|                                                               |
+---------------------------------------------------------------+
```

- Left nav: `w-56`, sticky (`sticky top-24`), scrolls independently
- Right content: `flex-1`, `max-w-2xl`
- Overall container: `flex gap-8`

#### 2.2 Tablet Layout (640px - 1023px)

Same as desktop but left nav collapses to horizontal tab bar at top:

```
+---------------------------------------------------------------+
|  PageHeader: "Settings"                                       |
|                                                               |
|  [Profile] [Notifications] [Appearance] [AI] [Integrations]  |
|  ─────────────────────────────────────────────────────────    |
|                                                               |
|  +----------------------------------------------------------+|
|  | Content Panel (full width, max-w-2xl, mx-auto)           ||
|  +----------------------------------------------------------+|
+---------------------------------------------------------------+
```

#### 2.3 Mobile Layout (< 640px)

Horizontal scrollable tab bar at top, single column content below:

```
+-----------------------------------+
|  PageHeader: "Settings"           |
|                                   |
|  [Profile] [Notif...] [Appear >  |
|  ────────────────────────────     |
|                                   |
|  +-------------------------------+|
|  | Card: Section content         ||
|  | (full width, px-0 card)       ||
|  +-------------------------------+|
+-----------------------------------+
```

---

### 3. Component Tree

```
SettingsPage (server component - layout only)
├── PageHeader (existing)
└── SettingsLayout (client component)
    ├── SettingsNav
    │   └── SettingsNavItem[] (icon + label, active state)
    │
    └── SettingsContent (renders active section)
        │
        ├── [section="profile"]
        │   └── ProfileSection
        │       ├── AvatarUploader
        │       ├── DisplayNameField (Input)
        │       └── EmailDisplay (read-only)
        │
        ├── [section="notifications"]
        │   └── NotificationSection
        │       ├── EnableToggle (custom switch)
        │       ├── FrequencySelector (radio group: daily/biweekly/weekly)
        │       ├── TimezoneSelector (searchable select/combobox)
        │       └── SendHourSelector (select 0-23)
        │
        ├── [section="appearance"]
        │   └── AppearanceSection
        │       └── ThemeSelector (3 visual cards: light/dark/system)
        │
        ├── [section="ai"]
        │   └── AIAssistantSection
        │       ├── ProviderDisplay (read-only badge)
        │       └── SystemPromptEditor (textarea)
        │
        └── [section="integrations"]
            └── IntegrationsSection
                └── HedyIntegrationCard (migrated from current settings)
                    ├── ApiKeyInput
                    ├── WebhookSetupButton
                    └── WebhookUrlDisplay
```

---

### 4. Component Detailed Definitions

#### 4.1 `SettingsLayout`

**File**: `src/components/settings/settings-layout.tsx`

**Responsibility**: Manages active section state, renders nav + content side by side.

```typescript
interface SettingsLayoutProps {
  defaultSection?: SettingsSection
}

type SettingsSection = "profile" | "notifications" | "appearance" | "ai" | "integrations"
```

**State**:
- `activeSection: SettingsSection` -- controlled via URL hash (`#notifications`) or local state
- Uses `useSearchParams` or hash-based navigation so sections are linkable

**Layout (Tailwind)**:
```html
<!-- Container -->
<div class="flex flex-col lg:flex-row gap-6 lg:gap-8">
  <!-- Nav: horizontal on mobile/tablet, vertical on desktop -->
  <nav class="
    flex lg:flex-col
    overflow-x-auto lg:overflow-x-visible
    gap-1
    lg:w-56 lg:shrink-0
    lg:sticky lg:top-24 lg:self-start
    border-b lg:border-b-0 lg:border-r
    pb-2 lg:pb-0 lg:pr-4
    -mx-4 px-4 lg:mx-0 lg:px-0
  ">
    {/* SettingsNavItem x5 */}
  </nav>

  <!-- Content -->
  <div class="flex-1 min-w-0 max-w-2xl">
    {/* Active section card */}
  </div>
</div>
```

#### 4.2 `SettingsNavItem`

**Responsibility**: Single nav item with icon, label, active indicator.

```typescript
interface SettingsNavItemProps {
  icon: LucideIcon
  label: string
  section: SettingsSection
  isActive: boolean
  onClick: () => void
}
```

**Styling**:
```html
<button class="
  flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md
  transition-colors whitespace-nowrap
  {isActive
    ? 'bg-primary/10 text-primary font-semibold'
    : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
">
  <Icon class="h-4 w-4" />
  {label}
</button>
```

Nav items configuration:
| Section | Icon (lucide) | Label |
|---------|---------------|-------|
| profile | `User` | Profile |
| notifications | `Bell` | Notifications |
| appearance | `Palette` | Appearance |
| ai | `Bot` | AI Assistant |
| integrations | `Plug` | Integrations |

#### 4.3 `ProfileSection`

**File**: `src/components/settings/profile-section.tsx`

```typescript
interface ProfileSectionProps {
  user: {
    id: string
    email: string
    displayName: string
    avatarUrl?: string
  }
}
```

**State**:
- `displayName: string`
- `avatarFile: File | null`
- `avatarPreview: string | null`
- `isSaving: boolean`

**Layout**:
```
+--------------------------------------------------+
| Card: Profile                                     |
| "Manage your personal information"                |
+--------------------------------------------------+
|                                                   |
|  [Avatar Circle]  [Change Photo] [Remove]         |
|   96x96px          ghost buttons                  |
|                                                   |
|  Display Name                                     |
|  +--------------------------------------------+  |
|  |  text input                                 |  |
|  +--------------------------------------------+  |
|                                                   |
|  Email                                            |
|  user@example.com  (read-only, muted text)        |
|                                                   |
|  ───────────────────────────────────────────────  |
|  [Save Changes]                    (bottom-right) |
+--------------------------------------------------+
```

**Avatar interaction**:
- Click avatar or "Change Photo" opens file picker (`accept="image/*"`)
- Preview updates immediately (URL.createObjectURL)
- Upload to Supabase Storage on save
- "Remove" resets to default initial

**API endpoints needed**:
- `PATCH /api/profile` -- update display_name, avatar_url
- Uses Supabase Storage `avatars` bucket (new or reuse existing)

#### 4.4 `NotificationSection`

**File**: `src/components/settings/notification-section.tsx`

```typescript
interface NotificationSectionProps {
  // Loaded from /api/notifications/settings
}

interface NotificationSettings {
  enabled: boolean
  frequency: "daily" | "biweekly" | "weekly"
  timezone: string     // IANA timezone
  send_hour: number    // 0-23
}
```

**Layout**:
```
+--------------------------------------------------+
| Card: Notifications                               |
| "Configure how and when you receive AI summaries" |
+--------------------------------------------------+
|                                                   |
|  Enable Notifications                             |
|  Receive periodic AI-generated summaries          |
|  ─────────────────────────────────── [Toggle]     |
|                                                   |
|  (below only visible when enabled)                |
|                                                   |
|  Frequency                                        |
|  +-----------+ +-----------+ +-----------+        |
|  | Daily     | | Bi-weekly | | Weekly    |        |
|  | (active)  | |           | |           |        |
|  +-----------+ +-----------+ +-----------+        |
|                                                   |
|  Timezone                                         |
|  +--------------------------------------------+  |
|  | Asia/Taipei                            [v] |  |
|  +--------------------------------------------+  |
|                                                   |
|  Delivery Hour                                    |
|  +--------------------------------------------+  |
|  | 09:00 (9 AM)                           [v] |  |
|  +--------------------------------------------+  |
|                                                   |
|  ───────────────────────────────────────────────  |
|  [Save]                                           |
+--------------------------------------------------+
```

**Toggle component** (custom, no library):
```html
<button
  role="switch"
  aria-checked={enabled}
  class="
    relative inline-flex h-6 w-11 shrink-0 cursor-pointer
    rounded-full border-2 border-transparent
    transition-colors duration-200 ease-in-out
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
    {enabled ? 'bg-primary' : 'bg-input'}
  "
>
  <span class="
    pointer-events-none inline-block h-5 w-5 rounded-full
    bg-background shadow-lg ring-0 transition-transform duration-200
    {enabled ? 'translate-x-5' : 'translate-x-0'}
  " />
</button>
```

**Frequency selector**: 3 bordered cards in a row, selected one has `ring-2 ring-primary bg-primary/5`

**Timezone selector**: Native `<select>` with common timezones grouped. List:
- UTC, America/New_York, America/Chicago, America/Denver, America/Los_Angeles
- Europe/London, Europe/Paris, Europe/Berlin
- Asia/Tokyo, Asia/Shanghai, Asia/Taipei, Asia/Singapore, Asia/Kolkata
- Australia/Sydney, Pacific/Auckland

**Save behavior**: Auto-save with debounce (500ms) on each change, or explicit save button. Recommendation: **explicit save button** for consistency and to avoid accidental changes.

#### 4.5 `AppearanceSection`

**File**: `src/components/settings/appearance-section.tsx`

```typescript
type Theme = "light" | "dark" | "system"
```

**Layout**:
```
+--------------------------------------------------+
| Card: Appearance                                  |
| "Customize the look and feel"                     |
+--------------------------------------------------+
|                                                   |
|  Theme                                            |
|                                                   |
|  +------------+ +------------+ +------------+     |
|  |   [Sun]    | |  [Moon]    | |  [Monitor] |     |
|  |   Light    | |   Dark     | |   System   |     |
|  |            | | (selected) | |            |     |
|  +------------+ +------------+ +------------+     |
|                                                   |
+--------------------------------------------------+
```

Each theme option is a card:
```html
<button class="
  flex flex-col items-center gap-2 p-4 rounded-lg border-2
  transition-all
  {isSelected
    ? 'border-primary bg-primary/5 text-primary'
    : 'border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/50'}
">
  <Icon class="h-6 w-6" />
  <span class="text-sm font-medium">{label}</span>
</button>
```

Icons: `Sun` (light), `Moon` (dark), `Monitor` (system)

**Implementation**: Uses `next-themes` or manual class toggle on `<html>`. Saves preference to localStorage + optionally to profile API.

**Note**: Current CSS only defines light theme variables (`:root`). To support dark mode, a `.dark` selector block with dark color values needs to be added to `globals.css`. This is a prerequisite for the appearance section to function.

#### 4.6 `AIAssistantSection`

**File**: `src/components/settings/ai-assistant-section.tsx`

```typescript
interface AIAssistantSectionProps {
  provider: "zeroclaw" | "openclaw"
  currentSystemPrompt: string
}
```

**Layout**:
```
+--------------------------------------------------+
| Card: AI Assistant                                |
| "Configure your AI assistant behavior"            |
+--------------------------------------------------+
|                                                   |
|  Provider                                         |
|  [ZeroClaw]  (Badge, read-only)                   |
|  Connected via default gateway                    |
|                                                   |
|  Custom System Prompt                             |
|  +--------------------------------------------+  |
|  |                                             |  |
|  |  textarea (6 rows, monospace font)          |  |
|  |  placeholder: "e.g., Always respond in      |  |
|  |  Traditional Chinese..."                    |  |
|  |                                             |  |
|  +--------------------------------------------+  |
|  128 / 2000 characters                            |
|                                                   |
|  [Info] This prompt is prepended to every          |
|  conversation with the AI assistant.              |
|                                                   |
|  ───────────────────────────────────────────────  |
|  [Save]                                           |
+--------------------------------------------------+
```

**Textarea styling**:
```html
<textarea class="
  w-full min-h-[150px] rounded-lg border border-input bg-transparent
  px-3 py-2 text-sm font-mono
  placeholder:text-muted-foreground
  focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
  resize-y
" />
```

#### 4.7 `IntegrationsSection`

Migrates the existing `SettingsPage` Hedy.ai card directly. The current implementation is already well-structured and can be extracted as-is into `src/components/settings/integrations-section.tsx`.

Changes from current:
- Remove `PageHeader` (handled by parent)
- Remove outer `max-w-3xl` wrapper (handled by parent layout)
- Keep all Hedy.ai logic intact
- Add a section header with future extensibility hint

```
+--------------------------------------------------+
| Card: Integrations                                |
| "Connect third-party services"                    |
+--------------------------------------------------+
|                                                   |
|  [Existing Hedy.ai Integration Card content]      |
|  (Step 1: API Key, Step 2: Webhook, etc.)         |
|                                                   |
+--------------------------------------------------+
|                                                   |
|  + Add Integration  (ghost button, future)        |
|                                                   |
+--------------------------------------------------+
```

---

### 5. Interaction Flow

#### 5.1 Section Navigation

```
User lands on /settings
  |
  +--> Default section: "profile" (first item)
  |
  +--> User clicks nav item
  |      |
  |      +--> activeSection state updates
  |      +--> URL hash updates (#notifications)
  |      +--> Content panel renders new section
  |      +--> Smooth scroll to top on mobile
  |
  +--> On mobile: horizontal scroll nav, tap to switch
```

#### 5.2 Form Save Flow

| Current State | Trigger | Next State | UI Change |
|---------------|---------|------------|-----------|
| Idle | User modifies field | Dirty | Save button becomes enabled (primary color) |
| Dirty | User clicks Save | Saving | Button shows spinner + "Saving...", fields disabled |
| Saving | API returns 200 | Success | Toast: "Settings saved", button back to disabled |
| Saving | API returns error | Error | Toast: error message, button re-enabled |
| Success | 2s timeout | Idle | No change |

#### 5.3 Avatar Upload Flow

```
User clicks avatar/Change Photo
  --> File picker opens (accept="image/*")
  --> User selects file
  --> Preview updates immediately (client-side blob URL)
  --> On Save: upload to Supabase Storage --> update profile --> refresh avatar
  --> On Cancel/navigate away: discard preview
```

---

### 6. Responsive Design

| Screen | Nav Style | Content Width | Spacing |
|--------|-----------|---------------|---------|
| Mobile (<640px) | Horizontal scroll tabs, `overflow-x-auto` | 100% | `px-4` |
| Tablet (640-1023px) | Horizontal tabs, centered | `max-w-2xl mx-auto` | `px-6` |
| Desktop (>=1024px) | Vertical sidebar, sticky | `max-w-2xl` | `gap-8` |

---

### 7. A11y Requirements

- Nav items: `role="tablist"` / `role="tab"` + `aria-selected`
- Content panels: `role="tabpanel"` + `aria-labelledby`
- Toggle switch: `role="switch"` + `aria-checked`
- Frequency selector: `role="radiogroup"` / `role="radio"` + `aria-checked`
- All form fields: `<label>` with `htmlFor`
- Error states: `aria-invalid` + `aria-describedby` on inputs
- Save button loading: `aria-disabled` + `aria-label="Saving settings"`
- Focus management: after section switch, focus moves to section heading

---

### 8. File Structure (Settings)

```
src/
├── app/(protected)/settings/
│   └── page.tsx                    # Server component, passes user data
├── components/settings/
│   ├── settings-layout.tsx         # Nav + content container
│   ├── settings-nav.tsx            # Category navigation
│   ├── profile-section.tsx         # Profile form
│   ├── notification-section.tsx    # Notification settings
│   ├── appearance-section.tsx      # Theme selector
│   ├── ai-assistant-section.tsx    # AI config
│   └── integrations-section.tsx    # Hedy.ai (migrated from current page)
```

---

---

## Part B: Chat Page Upgrade

### 1. Design Goals

**User Goals**:
- Maintain context by seeing conversation list while chatting
- Read AI responses with proper formatting (Markdown, code blocks)
- Quickly copy code, regenerate responses, and reference RAG sources
- Switch between regular chat and n8n workflow assistant mode

**Business Goals**:
- Increase chat engagement and session duration
- Improve n8n workflow generation success rate through better UX
- Enable future features (attachments, streaming) without layout redesign

---

### 2. Page Structure Design

#### 2.1 Route Architecture Change

**Current**:
- `/chat` -- server component, renders conversation list
- `/chat/new` -- does not exist as a file (likely handled elsewhere or broken)
- `/chat/[id]` -- does not exist as a file

**Proposed**:
- `/chat` -- client layout with sidebar + main area
- URL state: `/chat` (no conversation selected) / `/chat?c={conversationId}` (conversation open)
- Alternative: keep `/chat/[id]` route but use a shared layout with sidebar

**Recommended approach**: Single `/chat` page with query param `?c=xxx`. This avoids full page reloads when switching conversations and keeps the sidebar persistent.

#### 2.2 Desktop Layout (>= 1024px)

```
+------------------------------------------------------------------+
| AppSidebar (existing 256px)                                      |
+------------------------------------------------------------------+
|                                                                  |
| +------------------+ +----------------------------------------+ |
| | Chat Sidebar     | | Chat Main Area                         | |
| | (280px, border-r)| |                                         | |
| |                  | | +------------------------------------+ | |
| | [+ New Chat]     | | | Chat Header                        | | |
| |                  | | | "Conv Title"     [n8n toggle] [...] | | |
| | [Search...]      | | +------------------------------------+ | |
| |                  | |                                         | |
| | Today            | | +------------------------------------+ | |
| | > Conv 1 (active)| | | Messages Area (flex-1, overflow-y) | | |
| | > Conv 2         | | |                                     | | |
| |                  | | |  [User bubble]                      | | |
| | Yesterday        | | |       "How do I set up a webhook?"  | | |
| | > Conv 3         | | |                                     | | |
| | > Conv 4         | | |  [Assistant bubble]                 | | |
| |                  | | |  "Here's how to set up a webhook..." | | |
| | Last 7 days      | | |  ```code block with highlight```    | | |
| | > Conv 5         | | |  [Sources: Meeting Note #1]         | | |
| |                  | | |  [Copy] [Regenerate]                 | | |
| |                  | | |                                     | | |
| |                  | | +------------------------------------+ | |
| |                  | |                                         | |
| |                  | | +------------------------------------+ | |
| |                  | | | Input Area                          | | |
| |                  | | | +--------------------------------+ | | |
| |                  | | | | textarea (auto-grow)            | | | |
| |                  | | | |                                 | | | |
| |                  | | | +--------------------------------+ | | |
| |                  | | | [Attach] [n8n mode]      [Send]   | | | |
| |                  | | +------------------------------------+ | |
| +------------------+ +----------------------------------------+ |
+------------------------------------------------------------------+
```

#### 2.3 Mobile Layout (< 768px)

Two-state layout with slide transition:

**State 1: Sidebar visible (default when no conversation selected)**
```
+-----------------------------------+
| Chat           [+ New]            |
| +-------------------------------+ |
| | [Search...]                   | |
| +-------------------------------+ |
| | Today                         | |
| | +---------------------------+ | |
| | | Conv 1           2h ago   | | |
| | +---------------------------+ | |
| | | Conv 2           5h ago   | | |
| | +---------------------------+ | |
| | Yesterday                    | |
| | +---------------------------+ | |
| | | Conv 3           1d ago   | | |
| | +---------------------------+ | |
+-----------------------------------+
```

**State 2: Chat open (conversation selected)**
```
+-----------------------------------+
| [<- Back]  Conv Title   [...]     |
+-----------------------------------+
| Messages area (full height)       |
|                                   |
|  User: ...                        |
|  Assistant: ...                   |
|                                   |
+-----------------------------------+
| [textarea]                [Send]  |
+-----------------------------------+
```

---

### 3. Component Tree

```
ChatPage (client component)
├── ChatSidebar
│   ├── ChatSidebarHeader
│   │   ├── NewChatButton
│   │   └── SidebarCollapseButton (desktop only)
│   ├── ConversationSearch (Input with Search icon)
│   └── ConversationList
│       ├── ConversationGroup ("Today" / "Yesterday" / "Last 7 days" / "Older")
│       │   └── ConversationItem[]
│       │       ├── Title (truncated)
│       │       ├── Timestamp (relative)
│       │       └── ContextMenu (on right-click or [...] button)
│       │           ├── Rename
│       │           └── Delete
│       └── EmptyState (no conversations)
│
├── ChatMain
│   ├── ChatHeader
│   │   ├── MobileBackButton (mobile only)
│   │   ├── ConversationTitle
│   │   ├── ToolToggle (n8n mode indicator)
│   │   └── ChatActions (dropdown: rename, delete, clear)
│   │
│   ├── MessageList (virtualized scroll area)
│   │   └── MessageBubble[]
│   │       ├── UserMessage
│   │       │   └── MessageContent (plain text or minimal markdown)
│   │       └── AssistantMessage
│   │           ├── MarkdownRenderer
│   │           │   ├── CodeBlock (with syntax highlight + copy)
│   │           │   ├── N8nWorkflowBlock (special render for ```n8n-workflow```)
│   │           │   ├── Table
│   │           │   ├── List
│   │           │   └── Blockquote
│   │           ├── SourcesBar (RAG sources, collapsible)
│   │           └── MessageActions (hover toolbar)
│   │               ├── CopyButton
│   │               └── RegenerateButton
│   │
│   ├── TypingIndicator (3 dots animation, shown during API call)
│   │
│   └── ChatInput
│       ├── AutoGrowTextarea
│       ├── AttachButton (disabled/placeholder for future)
│       ├── ToolSelector (n8n toggle button)
│       └── SendButton
│
└── WelcomeScreen (shown when no conversation is selected)
    ├── Logo/Icon
    ├── "Start a new conversation"
    └── SuggestedPrompts[] (optional)
```

---

### 4. Component Detailed Definitions

#### 4.1 `ChatPage` (Root)

**File**: `src/app/(protected)/chat/page.tsx`

```typescript
// This becomes a client component that manages the chat layout
"use client"

interface ChatPageState {
  activeConversationId: string | null
  sidebarOpen: boolean              // mobile: controls sidebar visibility
  sidebarCollapsed: boolean         // desktop: narrow vs wide sidebar
  tool: "chat" | "n8n"
}
```

**Key behavior**:
- Reads `?c=xxx` from URL on mount to restore conversation
- Updates URL when switching conversations (shallow navigation)
- On mobile: `sidebarOpen` toggles between list view and chat view
- On desktop: sidebar is always visible (collapsible to icon-only 64px width)

**Layout shell**:
```html
<div class="flex h-[calc(100vh-var(--header-height,0px))] -m-4 md:-m-6 lg:-m-8">
  <!-- Sidebar -->
  <aside class="
    {mobile && !sidebarOpen ? 'hidden' : ''}
    {mobile && sidebarOpen ? 'w-full' : ''}
    {desktop && !sidebarCollapsed ? 'w-72' : ''}
    {desktop && sidebarCollapsed ? 'w-16' : ''}
    md:flex flex-col border-r bg-card shrink-0
    transition-all duration-200
  ">
    <ChatSidebar />
  </aside>

  <!-- Main -->
  <main class="
    flex-1 flex flex-col min-w-0
    {mobile && sidebarOpen ? 'hidden' : ''}
  ">
    {activeConversationId ? <ChatMain /> : <WelcomeScreen />}
  </main>
</div>
```

**Important layout note**: The chat page needs to fill the viewport height. The parent `<main>` in `ClientLayout` adds padding (`p-4 md:p-6 lg:p-8`). The chat page should use negative margins to counteract this and achieve full-bleed layout. The `h-[calc(100vh-...)]` accounts for the mobile header height if present.

#### 4.2 `ChatSidebar`

**File**: `src/components/chat/chat-sidebar.tsx`

```typescript
interface ChatSidebarProps {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
  onRename: (id: string, newTitle: string) => void
  onDelete: (id: string) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}

interface Conversation {
  id: string
  title: string
  updated_at: string
}
```

**Header**:
```html
<div class="flex items-center justify-between p-3 border-b">
  <h2 class="font-semibold text-sm {collapsed ? 'sr-only' : ''}">Chats</h2>
  <div class="flex items-center gap-1">
    <button title="New chat" class="p-2 rounded-md hover:bg-muted">
      <Plus class="h-4 w-4" />
    </button>
    <!-- Desktop only -->
    <button title="Collapse sidebar" class="hidden md:flex p-2 rounded-md hover:bg-muted">
      <PanelLeftClose class="h-4 w-4" />
    </button>
  </div>
</div>
```

**Search** (below header, visible when not collapsed):
```html
<div class="p-2">
  <div class="relative">
    <Search class="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
    <input
      type="text"
      placeholder="Search conversations..."
      class="w-full h-8 pl-9 pr-3 rounded-md border border-input bg-transparent text-sm"
    />
  </div>
</div>
```

**Conversation grouping logic**:
```typescript
function groupConversations(convs: Conversation[]) {
  const now = new Date()
  const groups: Record<string, Conversation[]> = {
    "Today": [],
    "Yesterday": [],
    "Last 7 days": [],
    "Last 30 days": [],
    "Older": [],
  }
  // ... date comparison logic
  return Object.entries(groups).filter(([, items]) => items.length > 0)
}
```

**Conversation item**:
```html
<button class="
  w-full text-left px-3 py-2 rounded-md text-sm
  flex items-center gap-2 group
  transition-colors
  {isActive
    ? 'bg-primary/10 text-primary font-medium'
    : 'text-foreground/80 hover:bg-muted'}
">
  <MessageSquare class="h-4 w-4 shrink-0 opacity-50" />
  <span class="truncate flex-1">{title}</span>
  <!-- Actions: visible on hover -->
  <div class="
    opacity-0 group-hover:opacity-100 transition-opacity
    flex items-center gap-0.5
  ">
    <button class="p-1 rounded hover:bg-muted-foreground/10">
      <MoreHorizontal class="h-3.5 w-3.5" />
    </button>
  </div>
</button>
```

**Context menu actions** (shown on [...] click, rendered as dropdown):
- Rename: Opens inline edit (input replaces title text)
- Delete: Opens `ConfirmDialog` (existing component)

#### 4.3 `ChatMain`

**File**: `src/components/chat/chat-main.tsx`

```typescript
interface ChatMainProps {
  conversationId: string
  tool: "chat" | "n8n"
  onToolChange: (tool: "chat" | "n8n") => void
  onBack: () => void   // mobile: return to sidebar
}
```

**Header bar**:
```html
<div class="flex items-center gap-3 px-4 h-14 border-b bg-card/80 backdrop-blur-sm shrink-0">
  <!-- Mobile back button -->
  <button class="md:hidden p-2 -ml-2 rounded-md hover:bg-muted">
    <ArrowLeft class="h-4 w-4" />
  </button>

  <h2 class="font-semibold text-sm truncate flex-1">{conversationTitle}</h2>

  <!-- n8n mode toggle -->
  <button class="
    flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
    transition-colors border
    {tool === 'n8n'
      ? 'bg-orange-500/10 text-orange-600 border-orange-500/30'
      : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'}
  ">
    <Zap class="h-3.5 w-3.5" />
    n8n
  </button>

  <!-- More actions -->
  <button class="p-2 rounded-md hover:bg-muted">
    <MoreVertical class="h-4 w-4" />
  </button>
</div>
```

#### 4.4 `MessageBubble`

**File**: `src/components/chat/message-bubble.tsx`

```typescript
interface MessageBubbleProps {
  role: "user" | "assistant"
  content: string
  sources?: Array<{ id: string; title: string | null; type: string }>
  n8n?: { name: string; status: string; n8nWorkflowId?: string | null; error?: string }
  timestamp?: string
  onCopy: () => void
  onRegenerate?: () => void   // only for last assistant message
}
```

**User message**:
```html
<div class="flex justify-end mb-4">
  <div class="max-w-[80%] lg:max-w-[70%]">
    <div class="bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5">
      <p class="text-sm whitespace-pre-wrap">{content}</p>
    </div>
  </div>
</div>
```

**Assistant message**:
```html
<div class="flex mb-4 group/msg">
  <div class="max-w-[85%] lg:max-w-[75%]">
    <!-- Avatar -->
    <div class="flex items-start gap-3">
      <div class="
        h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center
        shrink-0 mt-0.5
      ">
        <Bot class="h-4 w-4 text-primary" />
      </div>
      <div class="space-y-2 min-w-0">
        <!-- Rendered markdown content -->
        <div class="prose prose-sm prose-neutral dark:prose-invert max-w-none">
          <MarkdownRenderer content={content} />
        </div>

        <!-- RAG Sources (if any) -->
        {sources && (
          <div class="flex flex-wrap gap-1.5 mt-2">
            {sources.map(s => (
              <span class="
                inline-flex items-center gap-1 px-2 py-0.5
                text-xs bg-muted rounded-full text-muted-foreground
              ">
                <FileText class="h-3 w-3" />
                {s.title || s.type}
              </span>
            ))}
          </div>
        )}

        <!-- n8n workflow result (if any) -->
        {n8n && (
          <div class="
            mt-2 p-3 rounded-lg border text-sm
            {n8n.status === 'active' ? 'bg-green-500/5 border-green-500/20' :
             n8n.status === 'rejected' ? 'bg-red-500/5 border-red-500/20' :
             'bg-orange-500/5 border-orange-500/20'}
          ">
            <div class="flex items-center gap-2">
              <Zap class="h-4 w-4" />
              <span class="font-medium">{n8n.name}</span>
              <Badge variant="outline">{n8n.status}</Badge>
            </div>
            {n8n.error && <p class="text-destructive text-xs mt-1">{n8n.error}</p>}
          </div>
        )}

        <!-- Hover action bar -->
        <div class="
          flex items-center gap-1
          opacity-0 group-hover/msg:opacity-100
          transition-opacity
        ">
          <button title="Copy" class="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
            <Copy class="h-3.5 w-3.5" />
          </button>
          {onRegenerate && (
            <button title="Regenerate" class="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
              <RefreshCw class="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  </div>
</div>
```

#### 4.5 `MarkdownRenderer`

**File**: `src/components/chat/markdown-renderer.tsx`

```typescript
interface MarkdownRendererProps {
  content: string
}
```

**Implementation approach**: Use `react-markdown` + `remark-gfm` + `rehype-highlight` (or `shiki` for syntax highlighting).

**Dependencies to add**:
```
react-markdown
remark-gfm
rehype-highlight   (or rehype-shiki)
highlight.js       (if using rehype-highlight)
```

**Special handling for `n8n-workflow` code blocks**:
```typescript
// Custom code block renderer
function CodeBlock({ language, children }: { language: string; children: string }) {
  if (language === "n8n-workflow") {
    return <N8nWorkflowBlock content={children} />
  }

  return (
    <div class="relative group/code">
      <div class="absolute right-2 top-2 opacity-0 group-hover/code:opacity-100 transition-opacity">
        <button class="p-1.5 rounded bg-muted/80 hover:bg-muted text-muted-foreground">
          <Copy class="h-3.5 w-3.5" />
        </button>
      </div>
      <pre class="rounded-lg bg-muted/50 border p-4 overflow-x-auto">
        <code class="text-sm font-mono">{/* highlighted code */}</code>
      </pre>
      {language && (
        <span class="absolute top-2 left-3 text-xs text-muted-foreground">{language}</span>
      )}
    </div>
  )
}
```

**N8nWorkflowBlock** (special renderer):
```html
<div class="rounded-lg border border-orange-500/20 bg-orange-500/5 overflow-hidden">
  <div class="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border-b border-orange-500/20">
    <Zap class="h-4 w-4 text-orange-500" />
    <span class="text-sm font-medium text-orange-700">n8n Workflow</span>
    <button class="ml-auto p-1 rounded hover:bg-orange-500/10">
      <Copy class="h-3.5 w-3.5" />
    </button>
  </div>
  <pre class="p-3 overflow-x-auto text-xs font-mono max-h-[300px]">
    {/* Pretty-printed JSON */}
  </pre>
</div>
```

#### 4.6 `ChatInput`

**File**: `src/components/chat/chat-input.tsx`

```typescript
interface ChatInputProps {
  onSend: (message: string) => void
  isLoading: boolean
  tool: "chat" | "n8n"
  onToolChange: (tool: "chat" | "n8n") => void
}
```

**State**:
- `message: string`
- `textareaHeight: number` (auto-grow)

**Layout**:
```html
<div class="border-t bg-card px-4 py-3">
  <div class="max-w-3xl mx-auto">
    <div class="relative flex items-end gap-2">
      <!-- Textarea -->
      <div class="flex-1 relative">
        <textarea
          rows={1}
          class="
            w-full resize-none rounded-xl border border-input
            bg-transparent px-4 py-3 pr-12 text-sm
            placeholder:text-muted-foreground
            focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
            max-h-[200px] overflow-y-auto
          "
          placeholder="{tool === 'n8n'
            ? 'Describe the workflow you want to build...'
            : 'Type your message...'}"
          onInput={autoGrow}
          onKeyDown={handleKeyDown}   // Ctrl/Cmd+Enter to send
        />
      </div>

      <!-- Send button -->
      <button
        disabled={!message.trim() || isLoading}
        class="
          p-2.5 rounded-xl transition-colors shrink-0
          {message.trim() && !isLoading
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-muted text-muted-foreground cursor-not-allowed'}
        "
      >
        {isLoading
          ? <Loader2 class="h-5 w-5 animate-spin" />
          : <ArrowUp class="h-5 w-5" />}
      </button>
    </div>

    <!-- Bottom toolbar -->
    <div class="flex items-center gap-2 mt-2">
      <!-- Attach (placeholder) -->
      <button
        disabled
        title="Attachments (coming soon)"
        class="p-1.5 rounded-md text-muted-foreground/40 cursor-not-allowed"
      >
        <Paperclip class="h-4 w-4" />
      </button>

      <!-- n8n mode toggle -->
      <button
        onClick={() => onToolChange(tool === 'n8n' ? 'chat' : 'n8n')}
        class="
          flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
          transition-colors
          {tool === 'n8n'
            ? 'bg-orange-500/10 text-orange-600'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
        "
      >
        <Zap class="h-3.5 w-3.5" />
        n8n mode
      </button>

      <!-- Keyboard hint -->
      <span class="ml-auto text-xs text-muted-foreground hidden sm:inline">
        Ctrl+Enter to send
      </span>
    </div>
  </div>
</div>
```

**Auto-grow textarea logic**:
```typescript
function autoGrow(e: React.FormEvent<HTMLTextAreaElement>) {
  const target = e.currentTarget
  target.style.height = "auto"
  target.style.height = Math.min(target.scrollHeight, 200) + "px"
}
```

**Keyboard shortcuts**:
- `Ctrl+Enter` / `Cmd+Enter`: Send message
- `Enter`: New line (default textarea behavior)
- `Escape`: Clear input (optional)

#### 4.7 `TypingIndicator`

**File**: `src/components/chat/typing-indicator.tsx`

```html
<div class="flex items-start gap-3 mb-4">
  <div class="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
    <Bot class="h-4 w-4 text-primary" />
  </div>
  <div class="flex items-center gap-1 px-4 py-3 rounded-2xl bg-muted/50">
    <span class="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
    <span class="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
    <span class="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
  </div>
</div>
```

#### 4.8 `WelcomeScreen`

**File**: `src/components/chat/welcome-screen.tsx`

Shown when no conversation is selected.

```html
<div class="flex-1 flex flex-col items-center justify-center p-8 text-center">
  <div class="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
    <MessageSquare class="h-8 w-8 text-primary" />
  </div>
  <h2 class="text-2xl font-bold mb-2">How can I help you today?</h2>
  <p class="text-muted-foreground mb-8 max-w-md">
    Start a new conversation or select one from the sidebar.
  </p>
  <!-- Optional: suggestion chips -->
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full">
    <button class="
      p-4 rounded-xl border bg-card text-left
      hover:bg-muted/50 hover:border-primary/30 transition-colors
    ">
      <p class="text-sm font-medium">Summarize my meeting notes</p>
      <p class="text-xs text-muted-foreground mt-1">Get a quick overview of recent meetings</p>
    </button>
    <button class="...">
      <p class="text-sm font-medium">Create an n8n workflow</p>
      <p class="text-xs text-muted-foreground mt-1">Automate a task with n8n</p>
    </button>
  </div>
</div>
```

---

### 5. Interaction Flows

#### 5.1 Starting a New Conversation

```
User clicks [+ New Chat]
  --> Clear activeConversationId
  --> Show WelcomeScreen (or directly focus input)
  --> URL becomes /chat
  --> User types message and sends
  --> POST /api/chat (no conversationId)
  --> API creates conversation, returns conversationId
  --> URL updates to /chat?c={newId}
  --> Add new conversation to sidebar list (prepend)
  --> Show assistant response in message area
```

#### 5.2 Sending a Message

| State | Trigger | Next State | UI Change |
|-------|---------|------------|-----------|
| Idle | User types text | Composing | Send button activates (primary color) |
| Composing | Ctrl+Enter or click Send | Sending | User message appears immediately, TypingIndicator shows, input clears, Send button shows spinner |
| Sending | API returns response | Idle | TypingIndicator removed, assistant message renders with fade-in, scroll to bottom |
| Sending | API returns error | Error | Error toast, message stays in input (or retry banner) |
| Error | User clicks retry | Sending | Re-send last message |

#### 5.3 Message Actions

**Copy**:
- Click copy button on message hover bar
- Copies raw markdown/text to clipboard
- Button icon changes to Check for 2 seconds
- Toast: "Copied to clipboard"

**Regenerate** (last assistant message only):
- Click regenerate button
- Remove last assistant message from UI
- Show TypingIndicator
- Re-send last user message to API
- Display new response

#### 5.4 Conversation Management

**Rename**:
```
User clicks [...] on conversation item
  --> Dropdown appears: [Rename] [Delete]
  --> User clicks Rename
  --> Title text becomes editable input
  --> User types new name, presses Enter
  --> PATCH /api/conversations/{id} (new endpoint needed)
  --> Update sidebar list
  --> Update header title
```

**Delete**:
```
User clicks [...] -> Delete
  --> ConfirmDialog opens
  --> User confirms
  --> DELETE /api/conversations/{id} (new endpoint needed)
  --> Remove from sidebar
  --> If deleted conversation was active:
      --> Clear activeConversationId
      --> Show WelcomeScreen
```

#### 5.5 n8n Mode Toggle

```
User clicks n8n toggle
  --> tool state changes: "chat" <-> "n8n"
  --> Input placeholder changes
  --> Header shows orange n8n badge
  --> Messages sent with tool="n8n" parameter
  --> AI responses include n8n system prompt
  --> n8n-workflow code blocks render with special styling
```

#### 5.6 Streaming Display (Future Enhancement)

When streaming becomes available:

```
User sends message
  --> TypingIndicator shows briefly
  --> As tokens arrive:
      --> Replace TypingIndicator with partial message
      --> Append tokens to message content
      --> Auto-scroll follows bottom
  --> Stream complete:
      --> Message finalized
      --> Actions bar becomes available
      --> Sources bar appears (if any)
```

Implementation will require:
- `ReadableStream` from API route
- `EventSource` or `fetch` with stream reader on client
- Incremental markdown rendering (render partial markdown safely)

---

### 6. Responsive Design

| Screen | Sidebar | Messages | Input |
|--------|---------|----------|-------|
| Mobile (<768px) | Full-screen overlay, hidden during chat | Full width, bubble max-width 85% | Full width, single row default |
| Tablet (768-1023px) | 280px fixed | Remaining width, max-width 75% bubbles | Full width of content area |
| Desktop (>=1024px) | 280px, collapsible to 64px | Centered, max-width 3xl for input container | Max-width 3xl, centered |

**Mobile transitions**: Use CSS `transform: translateX()` for sidebar slide-in/out rather than display toggle, for smooth animation.

---

### 7. A11y Requirements

- Message list: `role="log"` + `aria-live="polite"` (new messages announced)
- Send button: `aria-label="Send message"` (no text label, only icon)
- Tool toggle: `aria-pressed={tool === 'n8n'}` + `aria-label="Toggle n8n workflow mode"`
- Conversation list: `role="listbox"` + `role="option"` with `aria-selected`
- Keyboard navigation:
  - `Tab` through sidebar items, then to input
  - `ArrowUp/ArrowDown` in conversation list
  - `Escape` closes context menus
- Copy button: `aria-label="Copy message to clipboard"`
- Regenerate button: `aria-label="Regenerate response"`
- Typing indicator: `aria-label="Assistant is typing"` + `role="status"`
- Code blocks: `aria-label="Code block, {language}"` with focusable copy button

---

### 8. File Structure (Chat)

```
src/
├── app/(protected)/chat/
│   └── page.tsx                        # Client component, chat layout shell
├── components/chat/
│   ├── chat-sidebar.tsx                # Conversation list sidebar
│   ├── chat-main.tsx                   # Header + messages + input container
│   ├── conversation-list.tsx           # Grouped conversation items
│   ├── conversation-item.tsx           # Single conversation row
│   ├── message-list.tsx                # Scrollable message container
│   ├── message-bubble.tsx              # User/assistant message rendering
│   ├── markdown-renderer.tsx           # Markdown -> React (with code highlight)
│   ├── n8n-workflow-block.tsx          # Special n8n code block render
│   ├── code-block.tsx                  # Generic code block with copy
│   ├── sources-bar.tsx                 # RAG sources pills
│   ├── chat-input.tsx                  # Textarea + toolbar
│   ├── typing-indicator.tsx            # 3-dot animation
│   └── welcome-screen.tsx             # Empty state / landing
├── hooks/
│   ├── use-chat.ts                     # Chat state management hook
│   │                                   # (conversations CRUD, message send/receive,
│   │                                   #  optimistic updates, error handling)
│   └── use-auto-scroll.ts             # Auto-scroll to bottom logic
```

---

## Shared: New API Endpoints Needed

| Method | Path | Purpose | Used By |
|--------|------|---------|---------|
| `PATCH` | `/api/profile` | Update display_name, avatar_url | Settings - Profile |
| `GET` | `/api/profile` | Get current user profile | Settings - Profile, AI |
| `PATCH` | `/api/conversations/[id]` | Rename conversation | Chat - context menu |
| `DELETE` | `/api/conversations/[id]` | Delete conversation + messages | Chat - context menu |

---

## Shared: New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react-markdown` | ^9.x | Markdown rendering in chat |
| `remark-gfm` | ^4.x | GFM support (tables, strikethrough, etc.) |
| `rehype-highlight` | ^7.x | Code syntax highlighting |
| `highlight.js` | ^11.x | Syntax highlighting engine |

Optional (if streaming is implemented):
| `eventsource-parser` | ^2.x | SSE stream parsing |

---

## Implementation Priority

### Phase 1 (Core)
1. Chat page restructure (sidebar + main layout)
2. `MarkdownRenderer` with code highlighting
3. `MessageBubble` with user/assistant styling
4. `ChatInput` with auto-grow textarea
5. Settings page layout (nav + sections shell)
6. Profile section
7. Integrations section (migrate existing)

### Phase 2 (Enhancement)
8. Notification section
9. AI assistant section
10. Conversation rename/delete
11. RAG sources display
12. n8n workflow block special rendering
13. Typing indicator
14. Welcome screen with suggested prompts

### Phase 3 (Polish)
15. Appearance section (requires dark mode CSS)
16. Sidebar collapse (desktop)
17. Mobile slide transitions
18. Keyboard shortcuts
19. Streaming display (when API supports it)
20. Avatar upload

---

## Design Tokens Reference

All styling uses existing Tailwind CSS 4 + shadcn/ui CSS variables:

| Token | Usage |
|-------|-------|
| `bg-card` | Card backgrounds, sidebar, input area |
| `bg-muted` | Hover states, code block backgrounds |
| `bg-primary/10` | Active nav items, avatar backgrounds |
| `bg-primary` | User message bubbles, CTA buttons |
| `text-primary` | Active labels, links |
| `text-muted-foreground` | Secondary text, timestamps, placeholders |
| `border-input` | Form field borders |
| `ring-ring/50` | Focus ring styling |
| `rounded-xl` | Cards, message bubbles |
| `rounded-2xl` | Chat bubbles (more rounded) |

Consistent with existing components: `Card`, `Button`, `Input`, `Badge`, `Avatar`, `Separator`, `Dialog`.
