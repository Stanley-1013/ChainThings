-- ChainThings: n8n workflow records

create table public.chainthings_workflows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  n8n_workflow_id text,
  name text not null,
  description text,
  prompt text,
  status text not null default 'pending' check (status in ('pending', 'generating', 'active', 'error')),
  n8n_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ct_workflows_tenant on public.chainthings_workflows(tenant_id);

alter table public.chainthings_workflows enable row level security;

create policy "Tenant isolation for workflows"
  on public.chainthings_workflows for all
  using (tenant_id = public.chainthings_current_tenant_id());
