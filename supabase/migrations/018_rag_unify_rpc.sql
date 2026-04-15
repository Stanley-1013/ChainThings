-- 018: Unify RAG RPCs on 1024-dim, fix content_tsv bug, tune HNSW index

-- 1. Rebuild HNSW index with tuned params
drop index if exists public.idx_ct_rag_chunks_embedding;
create index idx_ct_rag_chunks_embedding
  on public.chainthings_rag_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 32, ef_construction = 128);

-- 2. Drop stale 1536-dim RPC
drop function if exists public.chainthings_rag_hybrid_search(vector(1536), text, text[], integer, integer);
drop function if exists public.chainthings_rag_hybrid_search(vector(1536), text, text[], integer, integer, boolean, boolean, integer);

-- 3. Drop buggy 017 RPC (referenced non-existent search_vector column)
drop function if exists public.chainthings_hybrid_search(vector(1024), text, integer, text[], text, float, float, integer);

-- 4. Create canonical hybrid search RPC (1024-dim, uses content_tsv)
create or replace function public.chainthings_hybrid_search(
  query_embedding vector(1024),
  query_text text,
  p_source_types text[] default null,
  p_limit integer default 5,
  p_rrf_k integer default 60,
  p_enable_semantic boolean default true,
  p_enable_fulltext boolean default true,
  p_candidate_multiplier integer default 2
)
returns table (
  chunk_id uuid,
  document_id uuid,
  source_type text,
  source_id uuid,
  title text,
  content text,
  metadata jsonb,
  rrf_score double precision
)
language plpgsql stable security invoker
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  select public.chainthings_current_tenant_id() into v_tenant_id;
  if v_tenant_id is null then
    raise exception 'Unauthorized: no tenant context';
  end if;

  return query
  with semantic_search as (
    select
      c.id,
      c.document_id as doc_id,
      d.source_type as src_type,
      d.source_id as src_id,
      d.title as doc_title,
      c.content as chunk_content,
      c.metadata as chunk_metadata,
      row_number() over (order by c.embedding <=> query_embedding) as rank_ix
    from public.chainthings_rag_chunks c
    join public.chainthings_rag_documents d on d.id = c.document_id
    where p_enable_semantic
      and query_embedding is not null
      and c.tenant_id = v_tenant_id
      and d.tenant_id = v_tenant_id
      and d.status = 'completed'
      and (p_source_types is null or d.source_type = any(p_source_types))
      and c.embedding is not null
    order by c.embedding <=> query_embedding
    limit greatest(1, p_limit * p_candidate_multiplier)
  ),
  fulltext_search as (
    select
      c.id,
      c.document_id as doc_id,
      d.source_type as src_type,
      d.source_id as src_id,
      d.title as doc_title,
      c.content as chunk_content,
      c.metadata as chunk_metadata,
      row_number() over (order by ts_rank_cd(c.content_tsv, plainto_tsquery('english', query_text)) desc) as rank_ix
    from public.chainthings_rag_chunks c
    join public.chainthings_rag_documents d on d.id = c.document_id
    where p_enable_fulltext
      and nullif(trim(query_text), '') is not null
      and c.tenant_id = v_tenant_id
      and d.tenant_id = v_tenant_id
      and d.status = 'completed'
      and (p_source_types is null or d.source_type = any(p_source_types))
      and c.content_tsv @@ plainto_tsquery('english', query_text)
    order by ts_rank_cd(c.content_tsv, plainto_tsquery('english', query_text)) desc
    limit greatest(1, p_limit * p_candidate_multiplier)
  )
  select
    coalesce(s.id, f.id) as chunk_id,
    coalesce(s.doc_id, f.doc_id) as document_id,
    coalesce(s.src_type, f.src_type) as source_type,
    coalesce(s.src_id, f.src_id) as source_id,
    coalesce(s.doc_title, f.doc_title) as title,
    coalesce(s.chunk_content, f.chunk_content) as content,
    coalesce(s.chunk_metadata, f.chunk_metadata) as metadata,
    (coalesce(1.0 / (p_rrf_k + s.rank_ix), 0.0) + coalesce(1.0 / (p_rrf_k + f.rank_ix), 0.0))::double precision as rrf_score
  from semantic_search s
  full outer join fulltext_search f on s.id = f.id
  order by rrf_score desc
  limit p_limit;
end;
$$;

-- 5. Re-queue all existing embeddings (dimension changed from Jina to Qwen3)
update public.chainthings_rag_documents
  set status = 'pending', updated_at = now()
  where status = 'completed';

-- 6. Clear old embeddings (will be re-generated with new model)
delete from public.chainthings_rag_chunks;
