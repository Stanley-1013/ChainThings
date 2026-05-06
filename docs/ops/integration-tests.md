# Integration Test Suite (RLS)

This suite validates that Supabase Row-Level Security policies actually isolate
tenants — the core multi-tenant guarantee for ChainThings. It runs against a
real Postgres + GoTrue stack provisioned by the Supabase CLI, not mocks.

## What it covers

~95 tests (see headers in `src/__tests__/integration/rls/*.test.ts` for current counts) across 14 tables and 1 RPC:

| File | Tables | Tests |
|------|--------|-------|
| `smoke.test.ts` | profiles (via fixture chain) | 3 |
| `rls/conversations_messages.test.ts` | `chainthings_conversations`, `chainthings_messages` | 7 |
| `rls/task_center.test.ts` | `chainthings_items`, `chainthings_memory_entries`, `chainthings_notification_settings`, `chainthings_notification_cache` | 24 |
| `rls/integrations_dev_services.test.ts` | `chainthings_integrations`, `chainthings_dev_projects`, `chainthings_approval_tokens` | 18 |
| `rls/files_workflows.test.ts` | `chainthings_files`, `chainthings_workflows`, `chainthings_workflow_executions` | 15 |
| `rls/rag.test.ts` | `chainthings_rag_documents`, `chainthings_rag_chunks`, `chainthings_hybrid_search` RPC | 13 |

For each table, the standard pattern is six checks:
same-tenant insert+read works · cross-tenant SELECT blocked · cross-tenant
INSERT-spoof blocked · cross-tenant UPDATE no-op · cross-tenant DELETE no-op ·
anon sees nothing.

The RAG file additionally exercises the RPC's tenant-context guard:
`chainthings_hybrid_search` raises `Unauthorized: no tenant context` when called
without a JWT, and otherwise returns rows scoped to the caller's tenant only.

## Prerequisites

- Docker Desktop (the CLI provisions a small LinuxKit VM)
- Supabase CLI ≥ 2.95 (`brew install supabase/tap/supabase`)
- Node ≥ 22 (matches CI)

The dev Supabase stack and the CLI test stack run side-by-side on different
ports — kong/dev on `:8000`, CLI/test on `:54321`. No port conflicts.

## Local workflow

```bash
make test-stack-up       # boot test stack + apply 26 migrations
npm run test:integration # ~10 s on a warm cache
make test-stack-down     # stop containers (volumes preserved)
make test-stack-reset    # nuke volumes + restart (rare; use after migration changes)
```

First boot pulls ~1.5 GB of images (`supabase/postgres:15`, `gotrue`,
`storage-api`, `kong`, etc.). Subsequent boots are 10–20 seconds.

## CI workflow

`.github/workflows/integration.yml` runs on every PR and main push:

1. Check out repo
2. `supabase/setup-cli@v1`
3. `supabase start` (uses checked-in `supabase/config.toml`)
4. `npm ci`
5. `npm run test:integration`
6. `supabase stop` (always, even on failure)

Hosted runners: 60–90 s for the first image pull, then ~30 s for the test run.
Total wall time ≤ 3 min per PR. The job is separate from `ci.yml` so a flaky
GoTrue boot doesn't block unit-test signal.

## Helper API

`src/__tests__/integration/helpers/`:

- `stack-config.ts` — reads `SUPABASE_TEST_URL` / `_ANON_KEY` /
  `_SERVICE_ROLE_KEY` env vars, falls back to CLI deterministic defaults for
  `127.0.0.1:54321`.
- `fixtures.ts`
  - `fixtureTenant(label)` — admin creates a user with email
    `<label>-<uuid>@test.local`, the `on_auth_user_created` trigger inserts a
    `chainthings_profiles` row with a fresh `tenant_id`, and the helper signs
    in to obtain a real JWT. Returns `{ userId, email, password, jwt, tenantId }`.
  - `asUser(t)`, `asAdmin()`, `asAnon()` — Supabase JS clients with the
    appropriate authorization. RLS policies inspect the JWT from `asUser`.
  - `fakeVector1024(seed=0.01)` — constant-vector helper for embedding columns.
- `reset.ts`
  - `truncateAll()` — deletes every `auth.users` row whose email ends in
    `@test.local`. Cascade FKs (`chainthings_profiles.id` → `auth.users.id` and
    every business table → `chainthings_profiles.tenant_id`, all
    `ON DELETE CASCADE`) clean up the rest.

`src/__tests__/integration/setup.ts` runs once per file: sanity-check the stack
is reachable, then `truncateAll()`. Repeats `truncateAll()` in `afterAll` so the
next file / next CI run starts clean.

## Why no `beforeEach(truncateAll)`

We tried it first. With ~80 tests and 1–2 fixtures each, GoTrue's connection
pool got hammered with `admin.createUser` + `admin.deleteUser` cycles. The
visible failure was an intermittent 500 on `signInWithPassword` —
`sessions_user_id_fkey` FK violation followed by the prepared-statement close
failing in an aborted transaction. Pulling `truncateAll` out to file-level
made the failures vanish without weakening guarantees: every test calls
`fixtureTenant` for a fresh, distinct `tenant_id`, and RLS isolates each
tenant's view, so leftover rows from earlier tests in the same file are
invisible to the current test's clients.

## Migration constraints from the CLI tracking table

Two migration changes were needed for the CLI's `supabase_migrations.schema_migrations`
table to accept the existing migration set:

- Migration `005_storage.sql` now uses `INSERT ... ON CONFLICT (id) DO NOTHING`
  so the bucket seed is idempotent.
- The original `012_rag_search_tuning.sql` was renamed to
  `0119_rag_search_tuning.sql` (sorts between 011 and 012) so the CLI's
  per-file primary-key extraction doesn't collide with `012_notification_enhancements.sql`.

Neither change affects the dev/prod environments, which were applied via direct
SQL execution and don't have CLI tracking.

## Troubleshooting

**`supabase start` hangs pulling images** — Docker daemon may be wedged.
Restart Docker Desktop via Troubleshoot → Restart, then retry. Do not
`pkill -9` Docker processes; that breaks the LinuxKit VM network.

**`Database error granting user` on signin** — high-churn GoTrue
prepared-statement issue. Should not happen under file-level truncate. If it
recurs, check whether anything reintroduced `beforeEach(truncateAll)`.

**Migration `must be owner of table buckets`** — `[storage]` is disabled in
`config.toml`. Re-enable it; storage-api needs to boot to apply its baseline
schema (which adds the `public` column to `storage.buckets`).

**Test stack containers don't show up in `docker ps`** — they're prefixed
`supabase_*_ChainThings`. The dev stack uses `supabase-*` (hyphen, no project
suffix). They coexist.
