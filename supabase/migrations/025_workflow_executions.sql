-- 025: Workflow Executions — idempotency log for workflow saga
-- Stores each execution attempt with step-level results so that re-running
-- the same logical operation (same tenant + idempotency_key) returns the
-- cached result instead of creating duplicate external resources.

create table public.chainthings_workflow_executions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  dev_project_id uuid references public.chainthings_dev_projects(id) on delete cascade,
  idempotency_key text,
  workflow_name text not null,
  input_params jsonb not null default '{}',
  status text not null default 'running',   -- running | completed | failed
  step_results jsonb not null default '[]', -- [{id, status, result, error}]
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index idx_ct_workflow_executions_idem
  on public.chainthings_workflow_executions(tenant_id, idempotency_key)
  where idempotency_key is not null;

create index idx_ct_workflow_executions_tenant
  on public.chainthings_workflow_executions(tenant_id, created_at desc);

alter table public.chainthings_workflow_executions enable row level security;

create policy "Tenant isolation for workflow_executions"
  on public.chainthings_workflow_executions for all
  using (tenant_id = public.chainthings_current_tenant_id());
