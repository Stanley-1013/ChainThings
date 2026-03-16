-- ChainThings: assistant memory - per-tenant persistent memory entries

create table public.chainthings_memory_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  category text not null check (category in ('task', 'preference', 'fact', 'project', 'summary')),
  content text not null,
  importance integer default 5 check (importance between 1 and 10),
  status text not null default 'active' check (status in ('active', 'archived', 'expired')),
  source_type text,
  source_id uuid,
  last_referenced_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ct_memory_tenant_status on public.chainthings_memory_entries(tenant_id, status);
create index idx_ct_memory_tenant_category on public.chainthings_memory_entries(tenant_id, category);
create index idx_ct_memory_importance on public.chainthings_memory_entries(tenant_id, status, importance desc);

alter table public.chainthings_memory_entries enable row level security;

create policy "Tenant isolation for memory_entries"
  on public.chainthings_memory_entries for all
  using (tenant_id = public.chainthings_current_tenant_id());

-- Auto-queue memory entries for embedding when inserted/updated
create or replace function public.chainthings_queue_memory_embedding()
returns trigger as $$
declare
  v_hash text;
begin
  v_hash := md5(coalesce(new.category, '') || coalesce(new.content, ''));

  insert into public.chainthings_rag_documents (tenant_id, source_type, source_id, title, content_hash, status)
  values (new.tenant_id, 'memory', new.id, new.category, v_hash, 'pending')
  on conflict (tenant_id, source_type, source_id) do update
    set content_hash = excluded.content_hash,
        title = excluded.title,
        status = case
          when chainthings_rag_documents.content_hash != excluded.content_hash then 'pending'
          else chainthings_rag_documents.status
        end,
        updated_at = now();

  return new;
end;
$$ language plpgsql security definer;

create trigger on_memory_upsert_queue_embedding
  after insert or update of content on public.chainthings_memory_entries
  for each row
  when (new.status = 'active')
  execute function public.chainthings_queue_memory_embedding();
