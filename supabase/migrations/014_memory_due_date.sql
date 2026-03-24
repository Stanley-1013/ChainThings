-- 014: Add due_date column to memory_entries table
-- Supports: Task 4.3 (Memory task due_date support)

ALTER TABLE chainthings_memory_entries
  ADD COLUMN IF NOT EXISTS due_date timestamptz;

CREATE INDEX IF NOT EXISTS idx_memory_due_date
  ON chainthings_memory_entries(tenant_id, due_date)
  WHERE status = 'active' AND category = 'task' AND due_date IS NOT NULL;
