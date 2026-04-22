-- 021: Developer Service Integration Layer
-- Adds webhook events log, code reviews, test generations, cross-service links,
-- and extends integrations table for multi-service support.

-- ============================================================
-- A.4: Extend chainthings_integrations
-- ============================================================

alter table public.chainthings_integrations
  add column if not exists status text not null default 'active',
  add column if not exists secret_config bytea,
  add column if not exists capabilities text[] not null default '{}',
  add column if not exists last_error_at timestamptz,
  add column if not exists last_error_message text;

create index if not exists idx_ct_integrations_tenant_status
  on public.chainthings_integrations(tenant_id, status);

-- ============================================================
-- A.1: Webhook Events Log
-- ============================================================

create table public.chainthings_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  integration_id uuid references public.chainthings_integrations(id) on delete set null,
  service text not null,
  event_type text not null,
  normalized_event text,
  delivery_id text,
  payload jsonb not null default '{}',
  status text not null default 'received',
  error_message text,
  retry_count integer not null default 0,
  next_retry_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index idx_ct_webhook_events_dedupe
  on public.chainthings_webhook_events(integration_id, delivery_id)
  where delivery_id is not null;

create index idx_ct_webhook_events_worker
  on public.chainthings_webhook_events(status, created_at);

create index idx_ct_webhook_events_integration_status
  on public.chainthings_webhook_events(integration_id, status, created_at);

create index idx_ct_webhook_events_tenant_service
  on public.chainthings_webhook_events(tenant_id, service, created_at desc);

alter table public.chainthings_webhook_events enable row level security;

create policy "Tenant isolation for webhook_events"
  on public.chainthings_webhook_events for all
  using (tenant_id = public.chainthings_current_tenant_id());

-- ============================================================
-- A.2: Code Reviews
-- ============================================================

create table public.chainthings_code_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  integration_id uuid not null references public.chainthings_integrations(id) on delete cascade,
  webhook_event_id uuid references public.chainthings_webhook_events(id),
  service text not null,
  repo_ref text not null,
  subject_type text not null default 'merge_request',
  subject_ref text not null,
  subject_title text,
  subject_url text,
  diff_summary text,
  review_comments jsonb not null default '[]',
  review_status text not null default 'draft',
  ai_model text,
  token_usage jsonb,
  metadata jsonb default '{}',
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_ct_code_reviews_lookup
  on public.chainthings_code_reviews(tenant_id, service, repo_ref, subject_ref);

create index idx_ct_code_reviews_recent
  on public.chainthings_code_reviews(tenant_id, created_at desc);

create index idx_ct_code_reviews_status
  on public.chainthings_code_reviews(tenant_id, service, review_status);

alter table public.chainthings_code_reviews enable row level security;

create policy "Tenant isolation for code_reviews"
  on public.chainthings_code_reviews for all
  using (tenant_id = public.chainthings_current_tenant_id());

-- ============================================================
-- A.3: Test Generations
-- ============================================================

create table public.chainthings_test_generations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  integration_id uuid not null references public.chainthings_integrations(id) on delete cascade,
  service text not null,
  repo_ref text not null,
  source_type text not null,
  source_ref text,
  source_summary text,
  source_hash text,
  generated_tests text,
  language text,
  framework text,
  ai_model text,
  token_usage jsonb,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

create index idx_ct_test_generations_recent
  on public.chainthings_test_generations(tenant_id, created_at desc);

alter table public.chainthings_test_generations enable row level security;

create policy "Tenant isolation for test_generations"
  on public.chainthings_test_generations for all
  using (tenant_id = public.chainthings_current_tenant_id());

-- ============================================================
-- A.6: Cross-Service Links
-- ============================================================

create table public.chainthings_service_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  source_service text not null,
  source_integration_id uuid references public.chainthings_integrations(id) on delete set null,
  source_type text not null,
  source_ref text not null,
  source_url text,
  target_service text not null,
  target_integration_id uuid references public.chainthings_integrations(id) on delete set null,
  target_type text not null,
  target_ref text not null,
  target_url text,
  link_type text not null,
  status text not null default 'active',
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ct_service_links_source
  on public.chainthings_service_links(tenant_id, source_service, source_ref);

create index idx_ct_service_links_target
  on public.chainthings_service_links(tenant_id, target_service, target_ref);

alter table public.chainthings_service_links enable row level security;

create policy "Tenant isolation for service_links"
  on public.chainthings_service_links for all
  using (tenant_id = public.chainthings_current_tenant_id());
