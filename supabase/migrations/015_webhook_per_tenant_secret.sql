-- 015: Add per-tenant webhook_secret to integrations table
-- Supports: Task 4.5 (Hedy webhook per-tenant secret)

ALTER TABLE chainthings_integrations
  ADD COLUMN IF NOT EXISTS webhook_secret text;

-- Backfill existing hedy integrations with unique secrets
UPDATE chainthings_integrations
  SET webhook_secret = gen_random_uuid()
  WHERE service = 'hedy.ai' AND webhook_secret IS NULL;
