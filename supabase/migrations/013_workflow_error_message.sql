-- 013: Add error_message column to workflows table
-- Supports: Problem 2 (Workflow error transparency)

ALTER TABLE chainthings_workflows
  ADD COLUMN IF NOT EXISTS error_message text;
