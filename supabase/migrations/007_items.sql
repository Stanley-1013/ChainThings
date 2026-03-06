-- ChainThings: generic business data items

create table public.chainthings_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  integration_id uuid references public.chainthings_integrations(id) on delete set null,
  type text not null,
  title text,
  content text,
  metadata jsonb not null default '{}',
  external_id text,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ct_items_tenant on public.chainthings_items(tenant_id);
create index idx_ct_items_type on public.chainthings_items(tenant_id, type);
create index idx_ct_items_integration on public.chainthings_items(integration_id);
create index idx_ct_items_external on public.chainthings_items(tenant_id, external_id);

alter table public.chainthings_items enable row level security;

create policy "Tenant isolation for items"
  on public.chainthings_items for all
  using (tenant_id = public.chainthings_current_tenant_id());
