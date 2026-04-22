-- 022: Dev Projects — group integrations by user-defined project
-- Lets users manage multiple (Jira+GitLab+GitHub) credential sets per tenant,
-- one per "Dev Project" (e.g. "Client Alpha", "Internal Tools").

-- ============================================================
-- New table: chainthings_dev_projects
-- ============================================================

create table public.chainthings_dev_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  name text not null,                    -- 'Client Alpha'
  description text,                      -- Free text for AI context
  context_notes text,                    -- Workflow notes (e.g. 'Jira states: Backlog→In Dev→Review→Done')
  default_repo_ref text,                 -- 'owner/repo'
  default_jira_project text,             -- 'ALPHA'
  metadata jsonb not null default '{}',  -- Extensible: tags, priorities, etc.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, name)
);

create index idx_ct_dev_projects_tenant
  on public.chainthings_dev_projects(tenant_id);

alter table public.chainthings_dev_projects enable row level security;

create policy "Tenant isolation for dev_projects"
  on public.chainthings_dev_projects for all
  using (tenant_id = public.chainthings_current_tenant_id());

-- ============================================================
-- Refactor: chainthings_integrations
-- ============================================================

-- Drop the unique(tenant_id, service) constraint
-- Now users can have multiple Jira integrations (one per dev project)
alter table public.chainthings_integrations
  drop constraint if exists chainthings_integrations_tenant_id_service_key;

-- Add dev_project_id FK (nullable; non-dev integrations like hedy.ai keep null)
alter table public.chainthings_integrations
  add column if not exists dev_project_id uuid references public.chainthings_dev_projects(id) on delete cascade;

-- New unique: one (tenant, project, service) combo — allows multi-project multi-service
create unique index if not exists idx_ct_integrations_project_service
  on public.chainthings_integrations(tenant_id, dev_project_id, service)
  where dev_project_id is not null;

-- Keep backward-compat: services without dev_project (hedy.ai, zeroclaw, openclaw) still unique per tenant
create unique index if not exists idx_ct_integrations_tenant_service_no_project
  on public.chainthings_integrations(tenant_id, service)
  where dev_project_id is null;

create index if not exists idx_ct_integrations_dev_project
  on public.chainthings_integrations(dev_project_id);

-- ============================================================
-- Refactor: chainthings_service_links, code_reviews, test_generations
-- ============================================================

alter table public.chainthings_service_links
  add column if not exists dev_project_id uuid references public.chainthings_dev_projects(id) on delete cascade;

create index if not exists idx_ct_service_links_dev_project
  on public.chainthings_service_links(dev_project_id);

alter table public.chainthings_code_reviews
  add column if not exists dev_project_id uuid references public.chainthings_dev_projects(id) on delete set null;

create index if not exists idx_ct_code_reviews_dev_project
  on public.chainthings_code_reviews(dev_project_id);

alter table public.chainthings_test_generations
  add column if not exists dev_project_id uuid references public.chainthings_dev_projects(id) on delete set null;

create index if not exists idx_ct_test_generations_dev_project
  on public.chainthings_test_generations(dev_project_id);

alter table public.chainthings_webhook_events
  add column if not exists dev_project_id uuid references public.chainthings_dev_projects(id) on delete set null;

create index if not exists idx_ct_webhook_events_dev_project
  on public.chainthings_webhook_events(dev_project_id);

-- ============================================================
-- updated_at trigger
-- ============================================================

create or replace function public.chainthings_dev_projects_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_ct_dev_projects_updated_at
  before update on public.chainthings_dev_projects
  for each row execute function public.chainthings_dev_projects_touch_updated_at();
