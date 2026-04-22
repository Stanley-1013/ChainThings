-- 023: Dev Service Fixes
-- 1. Unique constraint on chainthings_service_links to prevent duplicate links from race conditions.
--    Scoped by dev_project_id when present (same Jira ticket can link to MRs in different projects).
-- 2. Index for retry worker query on chainthings_webhook_events.

-- ============================================================
-- 1. Unique constraint on chainthings_service_links
-- ============================================================

-- Drop the previous coarse constraint (if it was applied)
alter table public.chainthings_service_links
  drop constraint if exists chainthings_service_links_uniq;

-- When the link is scoped to a dev_project_id, include it in the uniqueness key
-- so the same Jira ticket can link to MRs in different projects.
create unique index if not exists idx_ct_service_links_uniq_project
  on public.chainthings_service_links
    (tenant_id, dev_project_id, source_service, source_ref, target_service, target_ref)
  where dev_project_id is not null;

-- When there is no dev_project_id, fall back to tenant-wide uniqueness.
create unique index if not exists idx_ct_service_links_uniq_no_project
  on public.chainthings_service_links
    (tenant_id, source_service, source_ref, target_service, target_ref)
  where dev_project_id is null;

-- ============================================================
-- 2. Index for retry worker query
-- ============================================================

create index if not exists idx_ct_webhook_events_retry
  on public.chainthings_webhook_events(next_retry_at)
  where status = 'received' and next_retry_at is not null;
