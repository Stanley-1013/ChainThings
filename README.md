# ChainThings

Multi-tenant platform integrating Supabase (with pgvector), AI gateway (ZeroClaw/OpenClaw), and n8n workflow automation. Each tenant gets isolated AI chat with RAG retrieval, meeting notes management, assistant memory, AI-generated notification digests, file management, workflow generation, and third-party integrations (e.g., Hedy.ai).

## Tech Stack

- **Framework**: Next.js 16 (App Router, React 19, TypeScript 5, Tailwind CSS 4)
- **Auth & Data**: Supabase (Auth + PostgreSQL + Storage + pgvector) with row-level security per tenant
- **AI Gateway**: ZeroClaw (default, `POST /webhook`) or OpenClaw (legacy, OpenAI-compatible) via `src/lib/ai-gateway/` abstraction layer
- **RAG**: pgvector hybrid search (vector + full-text + RRF fusion) with token-budgeted context injection
- **Workflow Engine**: n8n via REST API with node type allowlist
- **Deployment**: Docker (standalone) + docker-compose on `lab_net` network

## Features

- **AI Chat with RAG** — Retrieval-augmented generation: chat queries automatically search meeting notes, tasks, and assistant memory for relevant context
- **Meeting Notes** — Create notes manually (text/file upload) or auto-capture from Hedy.ai; AI extracts key points and action items
- **Assistant Memory** — Per-tenant persistent memory (tasks, preferences, facts) that the AI references across conversations
- **Notification Digests** — AI-generated summaries of pending tasks and recent meetings, cached to reduce token costs; configurable frequency (daily/biweekly/weekly) at user's local 09:00
- **Workflow Generation** — Describe a workflow in natural language, AI generates and deploys it to n8n
- **Multi-tenant Isolation** — Every table uses `tenant_id` + RLS; RAG search uses `SECURITY INVOKER` with auth-derived tenant context

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Running Supabase, n8n, and ZeroClaw/OpenClaw instances on the `lab_net` Docker network

### Development

```bash
cp .env.example .env.local
# Fill in your credentials in .env.local

npm install
npm run dev
```

App runs at `http://localhost:3001`.

### Docker

```bash
# One-command start (app + ngrok tunnel for n8n webhooks)
make up

# Or manually
docker compose up --build -d

# Check status
make status

# Stop everything
make down
```

### Apply Database Migrations

```bash
# Against a self-hosted Supabase:
for f in supabase/migrations/*.sql; do
  docker exec -i supabase-db psql -U supabase_admin -d postgres < "$f"
done
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase public URL (browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_URL` | Yes | Supabase internal URL (server) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `ZEROCLAW_GATEWAY_URL` | Yes | ZeroClaw AI gateway URL (default: `http://localhost:42617`) |
| `ZEROCLAW_GATEWAY_TOKEN` | Yes | ZeroClaw Bearer token (via `POST /pair`) |
| `DEFAULT_AI_PROVIDER` | No | `zeroclaw` (default) or `openclaw` |
| `OPENCLAW_GATEWAY_URL` | No | OpenClaw AI gateway URL (legacy) |
| `OPENCLAW_GATEWAY_TOKEN` | No | OpenClaw auth token (legacy) |
| `N8N_API_URL` | Yes | n8n API URL |
| `N8N_API_KEY` | Yes | n8n API key |
| `CHAINTHINGS_WEBHOOK_SECRET` | Yes | HMAC secret for webhook authentication |
| `CRON_SECRET` | No | Secret for internal cron-triggered notification generation |
| `NEXT_PUBLIC_APP_URL` | No | App public URL (default: `http://localhost:3001`) |
| `N8N_WEBHOOK_URL` | No | Public n8n webhook URL (e.g., `https://n8n.yourdomain.com`) |
| `N8N_TIMEOUT_MS` | No | n8n request timeout in ms (default: `10000`) |
| `ZEROCLAW_TIMEOUT_MS` | No | ZeroClaw request timeout in ms (default: `30000`) |
| `OPENCLAW_TIMEOUT_MS` | No | OpenClaw request timeout in ms (default: `30000`) |
| `SUPABASE_COOKIE_NAME` | No | Auth cookie name (default: `sb-localhost-auth-token`) |

## Project Structure

```
src/
  app/
    (auth)/                  # Login, register, OAuth callback
    (protected)/
      dashboard/             # Stats + notification panel
      chat/                  # AI chat with RAG context injection
      files/                 # File management
      workflows/             # Workflow management
      items/                 # Meeting notes list
      items/new/             # Create meeting notes (text/upload)
      settings/              # Integrations + AI & memory config
    api/
      chat/                  # AI chat with RAG retrieval + n8n tool mode
      files/upload/          # File upload to Supabase Storage
      workflows/generate/    # AI-generated n8n workflows
      integrations/          # Integration CRUD + Hedy webhook setup
      items/                 # Items CRUD (GET + POST)
      items/[id]/            # Single item (GET + DELETE)
      items/extract/         # AI extraction of key points + action items
      memory/                # Assistant memory CRUD
      notifications/         # Read + mark notifications
      notifications/settings/# Notification preferences
      notifications/generate/# AI digest generation (cron + user mode)
      rag/embed/             # Embedding queue processor
      webhooks/hedy/         # HMAC-authenticated webhook receiver
      auth/signout/          # Sign out
  lib/
    ai-gateway/              # Provider-agnostic AI client (chat + embeddings)
    rag/                     # RAG pipeline (chunker, search, worker)
    supabase/                # Browser, server, and admin clients
    n8n/                     # Workflow CRUD + node validation + Hedy template
  components/
    ui/                      # shadcn/ui components
    shared/                  # PageHeader, StatCard, NotificationPanel, etc.
    layout/                  # Sidebar, mobile header
  __tests__/                 # Shared mocks and test helpers
supabase/
  migrations/                # 12 incremental SQL migrations
```

## Database Migrations

Run migrations in order against your Supabase PostgreSQL instance:

| # | File | Description |
|---|------|-------------|
| 1 | `001_profiles.sql` | Profiles + auto tenant_id on signup |
| 2 | `002_conversations.sql` | Conversations + messages |
| 3 | `003_files.sql` | File metadata |
| 4 | `004_workflows.sql` | n8n workflow records |
| 5 | `005_storage.sql` | Storage bucket + policies (500MB limit) |
| 6 | `006_integrations.sql` | Integration configs |
| 7 | `007_items.sql` | Generic business data |
| 8 | `008_performance_indexes.sql` | Covering indexes for chat history, pagination |
| 9 | `009_rag_foundation.sql` | pgvector extension + RAG documents/chunks + HNSW/GIN indexes + hybrid search RPC + auto-embed trigger |
| 10 | `010_assistant_memory.sql` | Memory entries table + embedding trigger |
| 11 | `011_notifications.sql` | Notification settings + cache + dedup index |
| 12 | `012_rag_search_tuning.sql` | Mode-aware hybrid search with configurable fan-out |

All tables use `tenant_id` + RLS policies for multi-tenant isolation.

## Testing

108 tests across 15 test files using Vitest.

```bash
npx vitest run                    # Run all tests
npx vitest run --reporter=verbose # Detailed output
```

## Security

- **RAG tenant isolation**: Hybrid search RPC uses `SECURITY INVOKER`, deriving `tenant_id` from RLS auth context — no caller-supplied tenant parameter
- **Embedding worker safety**: Compare-and-set status claims prevent concurrent double-processing
- **Notification dedup**: Unique index on `(tenant_id, user_id, period_start, period_end)` + upsert
- **Webhook auth**: HMAC-SHA256 signature + 5-minute timestamp replay protection
- **n8n node allowlist**: AI-generated workflows restricted to safe transformation/routing nodes
- **Tenant isolation**: Per-tenant AI tokens, Supabase RLS on all 12 tables, n8n workflow tagging
- **Service key protection**: No Supabase service role keys in n8n workflow JSON
- **Request timeouts**: AbortController-based timeouts on all external service calls (AI 30s, n8n 10s)
- **Token efficiency**: Budget-capped context injection (history 1200t, RAG 900t, memory 250t), trivial message filtering, batch embeddings

## License

Private.
