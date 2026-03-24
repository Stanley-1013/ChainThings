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

- **AI Chat with SSE Streaming** — Server-Sent Events with phased status feedback (searching → thinking → streaming); separate timeouts for chat (60s) and RAG (10s)
- **RAG Retrieval** — Chat queries automatically search meeting notes, tasks, and assistant memory; upcoming deadlines injected into context
- **Auto Memory Extraction** — AI analyzes conversations to extract tasks, facts, and preferences; stores with dedup to assistant memory; supports `due_date` for task deadlines
- **Meeting Notes** — Create notes manually (text/file upload) or auto-capture from Hedy.ai; AI extracts key points and action items; auto-triggers RAG embedding
- **Assistant Memory** — Per-tenant persistent memory with automatic embedding; AI references across conversations and notifications
- **Notification Digests** — AI-generated summaries with upcoming deadline alerts; cached to reduce token costs; configurable frequency (daily/biweekly/weekly) at user's local 09:00
- **Workflow Generation** — Describe a workflow in natural language, AI generates and deploys it to n8n; transparent error display when n8n is unavailable
- **Multi-tenant Isolation** — Every table uses `tenant_id` + RLS; RAG search uses `SECURITY INVOKER`; per-tenant webhook HMAC secrets; timing-safe comparisons

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

### Live Demo

- **App**: https://darcey-phrenologic-shonda.ngrok-free.dev
- **n8n**: https://unlovely-unannunciable-denese.ngrok-free.dev

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
| `CHAINTHINGS_WEBHOOK_SECRET` | Yes | HMAC secret for webhook auth (legacy; new tenants use per-tenant secrets) |
| `CRON_SECRET` | No | Secret for internal cron-triggered notification generation |
| `NEXT_PUBLIC_APP_URL` | No | App public URL (default: `http://localhost:3001`) |
| `N8N_WEBHOOK_URL` | No | Public n8n webhook URL; also used as editor link fallback |
| `N8N_EDITOR_BASE_URL` | No | Override n8n editor URL if different from webhook URL |
| `N8N_TIMEOUT_MS` | No | n8n request timeout in ms (default: `10000`) |
| `ZEROCLAW_TIMEOUT_MS` | No | ZeroClaw base timeout in ms (default: `30000`) |
| `ZEROCLAW_CHAT_TIMEOUT_MS` | No | AI chat request timeout (default: `60000`, falls back to `ZEROCLAW_TIMEOUT_MS`) |
| `RAG_TIMEOUT_MS` | No | RAG stage timeout — embedding + search + memory (default: `10000`) |
| `AI_MEMORY_EXTRACTION` | No | Enable auto memory extraction from chat (default: `true`) |
| `OPENCLAW_TIMEOUT_MS` | No | OpenClaw request timeout in ms (default: `30000`) |
| `SUPABASE_COOKIE_NAME` | No | Auth cookie name (default: `sb-localhost-auth-token`) |

## Project Structure

```
src/
  app/
    (auth)/                  # Login, register, OAuth callback
    (protected)/
      dashboard/             # Stats + notification panel
      chat/                  # AI chat with SSE streaming + RAG context
      files/                 # File management
      workflows/             # Workflow management
      items/                 # Meeting notes list
      items/new/             # Create meeting notes (text/upload)
      settings/              # Integrations + AI & memory config
    api/
      chat/                  # AI chat (SSE + JSON) with RAG + n8n tool mode + memory extraction
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
    ai-gateway/              # Provider-agnostic AI client (chat + embeddings) with split timeouts
    chat/                    # SSE stream client for frontend
    memory/                  # Auto memory extraction from conversations
    rag/                     # RAG pipeline (chunker, search, worker with auto-trigger)
    supabase/                # Browser, server, and admin clients
    n8n/                     # Workflow CRUD + node validation + Hedy template + editor URL
  components/
    ui/                      # shadcn/ui components
    shared/                  # PageHeader, StatCard, NotificationPanel, etc.
    layout/                  # Sidebar, mobile header
  __tests__/                 # Shared mocks and test helpers
supabase/
  migrations/                # 16 incremental SQL migrations
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
| 13 | `013_workflow_error_message.sql` | Workflow error_message column for transparent failure display |
| 14 | `014_memory_due_date.sql` | Memory due_date column + partial index for task deadlines |
| 15 | `015_webhook_per_tenant_secret.sql` | Per-tenant webhook HMAC secret + backfill existing tenants |
| 16 | `016_notification_perf_indexes.sql` | Performance indexes for notification and query hot paths |

All tables use `tenant_id` + RLS policies for multi-tenant isolation.

## Testing

165 tests across 20 test files using Vitest.

```bash
npx vitest run                    # Run all tests
npx vitest run --reporter=verbose # Detailed output
```

## Security

- **RAG tenant isolation**: Hybrid search RPC uses `SECURITY INVOKER`, deriving `tenant_id` from RLS auth context — no caller-supplied tenant parameter
- **Embedding worker safety**: Compare-and-set status claims prevent concurrent double-processing
- **Notification dedup**: Unique index on `(tenant_id, user_id, period_start, period_end)` + upsert
- **Webhook auth**: Per-tenant HMAC-SHA256 secrets + timing-safe comparison + 5-minute replay protection
- **n8n node allowlist**: AI-generated workflows restricted to safe transformation/routing nodes
- **Tenant isolation**: Per-tenant AI tokens, Supabase RLS on all 16 tables, n8n workflow tagging, per-tenant webhook secrets
- **Service key protection**: No Supabase service role keys in n8n workflow JSON
- **Request timeouts**: Split AbortController timeouts — AI chat 60s, RAG/embedding 10s, n8n 10s, embedding trigger 5s, memory extraction 15s
- **Token efficiency**: Budget-capped context injection (history 1200t, RAG 900t, memory 250t, deadlines 150t), trivial message filtering, batch embeddings
- **Performance**: `next/server after()` for non-blocking background work, `Promise.all` for parallel DB queries, SSE delta 60ms throttle, memoized markdown rendering

## License

Private.
