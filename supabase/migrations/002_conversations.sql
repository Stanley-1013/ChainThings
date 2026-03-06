-- ChainThings: conversations + messages tables

create table public.chainthings_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  title text not null default 'New Conversation',
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ct_conversations_tenant on public.chainthings_conversations(tenant_id);

create table public.chainthings_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chainthings_conversations(id) on delete cascade,
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

create index idx_ct_messages_conversation on public.chainthings_messages(conversation_id, created_at);
create index idx_ct_messages_tenant on public.chainthings_messages(tenant_id);

-- RLS
alter table public.chainthings_conversations enable row level security;
alter table public.chainthings_messages enable row level security;

create policy "Tenant isolation for conversations"
  on public.chainthings_conversations for all
  using (tenant_id = public.chainthings_current_tenant_id());

create policy "Tenant isolation for messages"
  on public.chainthings_messages for all
  using (tenant_id = public.chainthings_current_tenant_id());
