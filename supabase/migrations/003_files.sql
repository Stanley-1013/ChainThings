-- ChainThings: file metadata table

create table public.chainthings_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  filename text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index idx_ct_files_tenant on public.chainthings_files(tenant_id);

alter table public.chainthings_files enable row level security;

create policy "Tenant isolation for files"
  on public.chainthings_files for all
  using (tenant_id = public.chainthings_current_tenant_id());
