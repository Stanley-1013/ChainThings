-- ChainThings: RAG foundation - pgvector + document/chunk tables + hybrid search RPC

-- Enable pgvector extension
create extension if not exists vector;

-- RAG documents table (tracks which source content needs embedding)
create table public.chainthings_rag_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  source_type text not null check (source_type in ('item', 'conversation', 'memory')),
  source_id uuid not null,
  source_version integer default 1,
  title text,
  content_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  error_message text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, source_type, source_id)
);

create index idx_ct_rag_docs_tenant_status on public.chainthings_rag_documents(tenant_id, status);
create index idx_ct_rag_docs_source on public.chainthings_rag_documents(tenant_id, source_type, source_id);

-- RAG chunks table (contains vector embeddings)
create table public.chainthings_rag_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  document_id uuid not null references public.chainthings_rag_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  content_tsv tsvector generated always as (to_tsvector('english', content)) stored,
  embedding vector(1536),
  token_count integer,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  unique(document_id, chunk_index)
);

create index idx_ct_rag_chunks_tenant on public.chainthings_rag_chunks(tenant_id);
create index idx_ct_rag_chunks_document on public.chainthings_rag_chunks(document_id);
create index idx_ct_rag_chunks_tsv on public.chainthings_rag_chunks using gin(content_tsv);
create index idx_ct_rag_chunks_embedding on public.chainthings_rag_chunks using hnsw(embedding vector_cosine_ops);

-- RLS
alter table public.chainthings_rag_documents enable row level security;
alter table public.chainthings_rag_chunks enable row level security;

create policy "Tenant isolation for rag_documents"
  on public.chainthings_rag_documents for all
  using (tenant_id = public.chainthings_current_tenant_id());

create policy "Tenant isolation for rag_chunks"
  on public.chainthings_rag_chunks for all
  using (tenant_id = public.chainthings_current_tenant_id());

-- Hybrid search RPC: vector similarity + full-text search with RRF fusion
-- SECURITY INVOKER: uses caller's RLS context, derives tenant_id from auth
create or replace function public.chainthings_rag_hybrid_search(
  query_embedding vector(1536),
  query_text text,
  p_source_types text[] default null,
  p_limit integer default 5,
  p_rrf_k integer default 60
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
    where c.tenant_id = v_tenant_id
      and d.tenant_id = v_tenant_id
      and d.status = 'completed'
      and (p_source_types is null or d.source_type = any(p_source_types))
      and c.embedding is not null
    order by c.embedding <=> query_embedding
    limit p_limit * 3
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
    where c.tenant_id = v_tenant_id
      and d.tenant_id = v_tenant_id
      and d.status = 'completed'
      and (p_source_types is null or d.source_type = any(p_source_types))
      and c.content_tsv @@ plainto_tsquery('english', query_text)
    order by ts_rank_cd(c.content_tsv, plainto_tsquery('english', query_text)) desc
    limit p_limit * 3
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

-- Auto-queue items for embedding when inserted/updated
create or replace function public.chainthings_queue_item_embedding()
returns trigger as $$
declare
  v_hash text;
begin
  v_hash := md5(coalesce(new.title, '') || coalesce(new.content, ''));

  insert into public.chainthings_rag_documents (tenant_id, source_type, source_id, title, content_hash, status)
  values (new.tenant_id, 'item', new.id, new.title, v_hash, 'pending')
  on conflict (tenant_id, source_type, source_id) do update
    set content_hash = excluded.content_hash,
        title = excluded.title,
        status = case
          when chainthings_rag_documents.content_hash != excluded.content_hash then 'pending'
          else chainthings_rag_documents.status
        end,
        source_version = chainthings_rag_documents.source_version + 1,
        updated_at = now();

  return new;
end;
$$ language plpgsql security definer;

create trigger on_item_upsert_queue_embedding
  after insert or update of title, content on public.chainthings_items
  for each row execute function public.chainthings_queue_item_embedding();
