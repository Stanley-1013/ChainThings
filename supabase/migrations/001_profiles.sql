-- ChainThings: profiles table + auto-create trigger + RLS

-- Profiles table
create table public.chainthings_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  tenant_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index idx_ct_profiles_tenant on public.chainthings_profiles(tenant_id);

-- Auto-create profile on signup
create or replace function public.chainthings_handle_new_user()
returns trigger as $$
begin
  insert into public.chainthings_profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.chainthings_handle_new_user();

-- RLS
alter table public.chainthings_profiles enable row level security;

create policy "Users can view own profile"
  on public.chainthings_profiles for select
  using (id = auth.uid());

create policy "Users can update own profile"
  on public.chainthings_profiles for update
  using (id = auth.uid());

-- Helper function: get current user's tenant_id (used by all RLS policies)
-- Must be created after the profiles table exists
create or replace function public.chainthings_current_tenant_id()
returns uuid as $$
  select tenant_id from public.chainthings_profiles where id = auth.uid()
$$ language sql stable security definer;
