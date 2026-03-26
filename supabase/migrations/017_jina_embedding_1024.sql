-- 017: Switch embedding dimensions from 1536 (OpenAI) to 1024 (Jina)
-- Safe: chainthings_rag_chunks is currently empty

DROP INDEX IF EXISTS idx_ct_rag_chunks_embedding;

ALTER TABLE chainthings_rag_chunks
  ALTER COLUMN embedding TYPE vector(1024);

CREATE INDEX idx_ct_rag_chunks_embedding
  ON chainthings_rag_chunks USING hnsw (embedding vector_cosine_ops);

-- Update hybrid search RPC to accept 1024-dim vectors
CREATE OR REPLACE FUNCTION chainthings_hybrid_search(
  query_embedding vector(1024),
  query_text text,
  match_count int DEFAULT 5,
  source_types text[] DEFAULT NULL,
  search_mode text DEFAULT 'hybrid',
  vector_weight float DEFAULT 0.7,
  text_weight float DEFAULT 0.3,
  fan_out int DEFAULT 20
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  tenant_id uuid,
  content text,
  source_type text,
  title text,
  similarity float
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  tenant uuid;
BEGIN
  tenant := (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid;
  IF tenant IS NULL THEN
    tenant := auth.uid();
    IF tenant IS NULL THEN
      RAISE EXCEPTION 'No tenant context available';
    END IF;
    SELECT p.tenant_id INTO tenant FROM chainthings_profiles p WHERE p.id = tenant;
  END IF;

  IF search_mode = 'semantic' THEN
    RETURN QUERY
    SELECT c.id, c.document_id, d.tenant_id, c.content, d.source_type, d.title,
           1 - (c.embedding <=> query_embedding) AS similarity
    FROM chainthings_rag_chunks c
    JOIN chainthings_rag_documents d ON c.document_id = d.id
    WHERE d.tenant_id = tenant AND d.status = 'completed'
      AND (source_types IS NULL OR d.source_type = ANY(source_types))
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
  ELSIF search_mode = 'fulltext' THEN
    RETURN QUERY
    SELECT c.id, c.document_id, d.tenant_id, c.content, d.source_type, d.title,
           ts_rank(c.search_vector, websearch_to_tsquery('english', query_text))::float AS similarity
    FROM chainthings_rag_chunks c
    JOIN chainthings_rag_documents d ON c.document_id = d.id
    WHERE d.tenant_id = tenant AND d.status = 'completed'
      AND (source_types IS NULL OR d.source_type = ANY(source_types))
      AND c.search_vector @@ websearch_to_tsquery('english', query_text)
    ORDER BY similarity DESC
    LIMIT match_count;
  ELSE
    RETURN QUERY
    WITH vector_results AS (
      SELECT c.id, 1 - (c.embedding <=> query_embedding) AS score
      FROM chainthings_rag_chunks c
      JOIN chainthings_rag_documents d ON c.document_id = d.id
      WHERE d.tenant_id = tenant AND d.status = 'completed'
        AND (source_types IS NULL OR d.source_type = ANY(source_types))
      ORDER BY c.embedding <=> query_embedding
      LIMIT fan_out
    ),
    text_results AS (
      SELECT c.id, ts_rank(c.search_vector, websearch_to_tsquery('english', query_text))::float AS score
      FROM chainthings_rag_chunks c
      JOIN chainthings_rag_documents d ON c.document_id = d.id
      WHERE d.tenant_id = tenant AND d.status = 'completed'
        AND (source_types IS NULL OR d.source_type = ANY(source_types))
        AND c.search_vector @@ websearch_to_tsquery('english', query_text)
      LIMIT fan_out
    ),
    combined AS (
      SELECT COALESCE(v.id, t.id) AS chunk_id,
             COALESCE(v.score, 0) * vector_weight + COALESCE(t.score, 0) * text_weight AS rrf_score
      FROM vector_results v
      FULL OUTER JOIN text_results t ON v.id = t.id
    )
    SELECT c.id, c.document_id, d.tenant_id, c.content, d.source_type, d.title,
           cb.rrf_score AS similarity
    FROM combined cb
    JOIN chainthings_rag_chunks c ON c.id = cb.chunk_id
    JOIN chainthings_rag_documents d ON c.document_id = d.id
    ORDER BY cb.rrf_score DESC
    LIMIT match_count;
  END IF;
END;
$$;
