-- 016: Performance indexes for notification and query hot paths

CREATE INDEX IF NOT EXISTS idx_ct_notif_cache_latest
  ON chainthings_notification_cache (tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ct_items_tenant_created
  ON chainthings_items (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ct_memory_active_task_updated
  ON chainthings_memory_entries (tenant_id, updated_at DESC)
  WHERE status = 'active' AND category = 'task';
