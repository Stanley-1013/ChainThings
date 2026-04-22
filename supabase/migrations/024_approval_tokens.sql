-- 024: Approval Tokens — durable, replay-safe, per-tenant, params-bound
-- Replaces the in-memory Set in src/lib/dev-services/approval.ts.
-- Each destructive action approval is stored as a row; consumption is a
-- single CAS UPDATE (consumed_at IS NULL AND expires_at > now()), so
-- multi-replica / serverless deployments cannot replay the same token.

create table public.chainthings_approval_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  action text not null,
  params_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_ct_approval_tokens_tenant
  on public.chainthings_approval_tokens(tenant_id, expires_at);

alter table public.chainthings_approval_tokens enable row level security;

create policy "Tenant isolation for approval_tokens"
  on public.chainthings_approval_tokens for all
  using (tenant_id = public.chainthings_current_tenant_id());

-- Optional: purge expired tokens daily via pg_cron.
-- Uncomment if pg_cron is available in your Supabase project:
--
-- select cron.schedule(
--   'purge-expired-approval-tokens',
--   '0 3 * * *',
--   $$delete from public.chainthings_approval_tokens
--     where expires_at < now() - interval '1 day'$$
-- );
