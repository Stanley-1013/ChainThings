# ChainThings

Multi-tenant platform integrating Supabase, OpenClaw AI, and n8n workflow automation. Each tenant gets isolated chat, file management, workflow generation, and third-party integrations (e.g., Hedy.ai meeting notes).

## Tech Stack

- **Framework**: Next.js 16 (App Router, React 19, TypeScript 5, Tailwind CSS 4)
- **Auth & Data**: Supabase (Auth + PostgreSQL + Storage) with row-level security per tenant
- **AI Gateway**: OpenClaw (OpenAI-compatible API) with per-tenant token isolation
- **Workflow Engine**: n8n via REST API with node type allowlist
- **Deployment**: Docker (standalone) + docker-compose on `lab_net` network

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Running Supabase, n8n, and OpenClaw instances on the `lab_net` Docker network

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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase public URL (browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_URL` | Yes | Supabase internal URL (server) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `OPENCLAW_GATEWAY_URL` | Yes | OpenClaw AI gateway URL |
| `OPENCLAW_GATEWAY_TOKEN` | Yes | OpenClaw auth token |
| `N8N_API_URL` | Yes | n8n API URL |
| `N8N_API_KEY` | Yes | n8n API key |
| `CHAINTHINGS_WEBHOOK_SECRET` | Yes | HMAC secret for webhook authentication |
| `NEXT_PUBLIC_APP_URL` | No | App public URL (default: `http://localhost:3001`) |
| `N8N_WEBHOOK_URL` | No | Public n8n webhook URL (e.g., `https://n8n.yourdomain.com`) |
| `N8N_TIMEOUT_MS` | No | n8n request timeout in ms (default: `10000`) |
| `OPENCLAW_TIMEOUT_MS` | No | OpenClaw request timeout in ms (default: `30000`) |
| `SUPABASE_COOKIE_NAME` | No | Auth cookie name (default: `sb-localhost-auth-token`) |

## Project Structure

```
src/
  app/
    (auth)/              # Login, register, OAuth callback
    (protected)/         # Dashboard, chat, files, workflows, settings
    api/
      chat/              # AI chat with per-tenant OpenClaw config
      files/upload/      # File upload to Supabase Storage
      workflows/generate/# AI-generated n8n workflows
      integrations/      # Integration CRUD + Hedy setup
      items/             # Generic business data CRUD
      webhooks/hedy/     # HMAC-authenticated webhook receiver
      auth/signout/      # Sign out
  lib/
    supabase/            # Browser, server, and admin clients
    openclaw/            # AI chat completion with timeout + tenant isolation
    n8n/                 # Workflow CRUD with timeout + node validation
  __tests__/             # Shared mocks and test helpers
supabase/
  migrations/            # 8 incremental SQL migrations
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

All tables use `tenant_id` + RLS policies for multi-tenant isolation.

## Testing

71 tests across 9 API route test files using Vitest.

```bash
npx vitest run                    # Run all tests
npx vitest run --reporter=verbose # Detailed output
```

## Security

- **Webhook auth**: HMAC-SHA256 signature + 5-minute timestamp replay protection
- **n8n node allowlist**: AI-generated workflows restricted to safe transformation/routing nodes
- **Tenant isolation**: Per-tenant OpenClaw tokens, Supabase RLS, n8n workflow tagging
- **Service key protection**: No Supabase service role keys in n8n workflow JSON
- **Request timeouts**: AbortController-based timeouts on all external service calls

## License

Private.
