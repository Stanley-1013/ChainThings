-- ChainThings: service integrations (credentials, endpoints)

create table public.chainthings_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  service text not null,
  label text,
  config jsonb not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, service)
);

create index idx_ct_integrations_tenant on public.chainthings_integrations(tenant_id);

alter table public.chainthings_integrations enable row level security;

create policy "Tenant isolation for integrations"
  on public.chainthings_integrations for all
  using (tenant_id = public.chainthings_current_tenant_id());
