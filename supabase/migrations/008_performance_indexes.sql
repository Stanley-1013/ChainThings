-- Covering index for chat history lookups:
-- SELECT role, content FROM chainthings_messages
--   WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 50
CREATE INDEX IF NOT EXISTS idx_messages_conversation_history
  ON chainthings_messages (conversation_id, created_at ASC)
  INCLUDE (role, content);

-- Index for conversation list pagination
CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON chainthings_conversations (tenant_id, updated_at DESC);

-- Index for workflows list pagination
CREATE INDEX IF NOT EXISTS idx_workflows_created
  ON chainthings_workflows (tenant_id, created_at DESC);
