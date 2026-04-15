-- 019: Add unique constraint on (tenant_id, external_id) to prevent duplicate items
-- from concurrent webhook calls for the same session

-- Clean up any existing duplicates first (keep the most recently updated)
delete from public.chainthings_items a
  using public.chainthings_items b
  where a.tenant_id = b.tenant_id
    and a.external_id = b.external_id
    and a.external_id is not null
    and a.updated_at < b.updated_at;

create unique index if not exists idx_ct_items_tenant_external_unique
  on public.chainthings_items(tenant_id, external_id)
  where external_id is not null;
