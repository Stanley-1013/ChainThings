-- 027: RLS Policy Strengthening — close cross-tenant FK reference leaks
--
-- Security gap class: "child-table tenant_id only" policies
--   Each affected table has two independent columns that must agree on tenant
--   ownership, but the original policy only checked one (tenant_id). The FK
--   column was validated at the DB referential-integrity level (row exists)
--   but NOT at the RLS level (row belongs to the caller's tenant). Because
--   PostgreSQL FK checks bypass RLS on the referenced table, a row with
--   tenant_id = A can reference a parent row that belongs to tenant B.
--
-- Fix pattern for each table:
--   1. Keep the existing USING clause unchanged (reads still tenant-scoped).
--   2. Add a WITH CHECK clause that validates the FK column also resolves to
--      a row in the caller's tenant, closing the write-path gap.
--
-- Policy names are kept identical to the originals so dependent code/tooling
-- that references policy names by string is unaffected.
--
-- Append-only: existing policies are dropped then re-created (idempotent).

-- ============================================================
-- 1. chainthings_messages
--    Gap: conversation_id FK accepts any conversations.id regardless of
--    its tenant_id. Fix: WITH CHECK ensures the conversation belongs to
--    the caller's own tenant.
-- ============================================================

drop policy if exists "Tenant isolation for messages"
  on public.chainthings_messages;

create policy "Tenant isolation for messages"
  on public.chainthings_messages for all
  using (tenant_id = public.chainthings_current_tenant_id())
  with check (
    tenant_id = public.chainthings_current_tenant_id()
    and exists (
      select 1 from public.chainthings_conversations c
      where c.id = conversation_id
        and c.tenant_id = public.chainthings_current_tenant_id()
    )
  );

-- ============================================================
-- 2. chainthings_workflow_executions
--    Gap: dev_project_id FK (nullable) accepts any dev_projects.id
--    regardless of tenant. Fix: when dev_project_id IS NOT NULL, require
--    it to resolve to a dev_project owned by the caller's tenant.
-- ============================================================

drop policy if exists "Tenant isolation for workflow_executions"
  on public.chainthings_workflow_executions;

create policy "Tenant isolation for workflow_executions"
  on public.chainthings_workflow_executions for all
  using (tenant_id = public.chainthings_current_tenant_id())
  with check (
    tenant_id = public.chainthings_current_tenant_id()
    and (
      dev_project_id is null
      or exists (
        select 1 from public.chainthings_dev_projects dp
        where dp.id = dev_project_id
          and dp.tenant_id = public.chainthings_current_tenant_id()
      )
    )
  );

-- ============================================================
-- 3. chainthings_integrations
--    Gap: dev_project_id FK (nullable) accepts any dev_projects.id
--    regardless of tenant. Fix: same IS NULL OR EXISTS pattern.
-- ============================================================

drop policy if exists "Tenant isolation for integrations"
  on public.chainthings_integrations;

create policy "Tenant isolation for integrations"
  on public.chainthings_integrations for all
  using (tenant_id = public.chainthings_current_tenant_id())
  with check (
    tenant_id = public.chainthings_current_tenant_id()
    and (
      dev_project_id is null
      or exists (
        select 1 from public.chainthings_dev_projects dp
        where dp.id = dev_project_id
          and dp.tenant_id = public.chainthings_current_tenant_id()
      )
    )
  );

-- ============================================================
-- 4. chainthings_notification_settings
--    Gap: user_id FK accepts any auth.users.id — tenant A could write a
--    row whose user_id belongs to tenant B's user.
--    Fix: USING keeps broad tenant-team read access; WITH CHECK additionally
--    requires user_id = auth.uid() so only the authenticated user can write
--    their own settings row.
-- ============================================================

drop policy if exists "Tenant isolation for notification_settings"
  on public.chainthings_notification_settings;

create policy "Tenant isolation for notification_settings"
  on public.chainthings_notification_settings for all
  using (tenant_id = public.chainthings_current_tenant_id())
  with check (
    tenant_id = public.chainthings_current_tenant_id()
    and user_id = auth.uid()
  );

-- ============================================================
-- 5. chainthings_notification_cache
--    Gap: same as notification_settings — user_id is not validated on write.
-- ============================================================

drop policy if exists "Tenant isolation for notification_cache"
  on public.chainthings_notification_cache;

create policy "Tenant isolation for notification_cache"
  on public.chainthings_notification_cache for all
  using (tenant_id = public.chainthings_current_tenant_id())
  with check (
    tenant_id = public.chainthings_current_tenant_id()
    and user_id = auth.uid()
  );

-- ============================================================
-- 6. chainthings_rag_chunks
--    Gap: document_id FK accepts any rag_documents.id regardless of
--    tenant. Fix: WITH CHECK ensures the parent document belongs to
--    the caller's own tenant.
-- ============================================================

drop policy if exists "Tenant isolation for rag_chunks"
  on public.chainthings_rag_chunks;

create policy "Tenant isolation for rag_chunks"
  on public.chainthings_rag_chunks for all
  using (tenant_id = public.chainthings_current_tenant_id())
  with check (
    tenant_id = public.chainthings_current_tenant_id()
    and exists (
      select 1 from public.chainthings_rag_documents d
      where d.id = document_id
        and d.tenant_id = public.chainthings_current_tenant_id()
    )
  );
