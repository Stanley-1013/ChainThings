-- ChainThings: notification system - settings + cache tables

-- Notification settings (per user)
create table public.chainthings_notification_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  frequency text not null default 'weekly' check (frequency in ('daily', 'biweekly', 'weekly')),
  timezone text not null default 'Asia/Taipei',
  send_hour_local integer not null default 9 check (send_hour_local between 0 and 23),
  last_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, user_id)
);

-- Notification cache (AI-generated summaries/reminders)
create table public.chainthings_notification_cache (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.chainthings_profiles(tenant_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  content jsonb not null default '{}',
  source_watermark timestamptz,
  status text not null default 'generated' check (status in ('generating', 'generated', 'shown', 'expired')),
  scheduled_for_utc timestamptz not null,
  generated_at timestamptz default now(),
  shown_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_ct_notif_settings_tenant on public.chainthings_notification_settings(tenant_id, user_id);
create index idx_ct_notif_cache_tenant on public.chainthings_notification_cache(tenant_id, user_id, status);
create index idx_ct_notif_cache_schedule on public.chainthings_notification_cache(scheduled_for_utc, status);
create unique index idx_ct_notif_cache_unique_period on public.chainthings_notification_cache(tenant_id, user_id, period_start, period_end);

alter table public.chainthings_notification_settings enable row level security;
alter table public.chainthings_notification_cache enable row level security;

create policy "Tenant isolation for notification_settings"
  on public.chainthings_notification_settings for all
  using (tenant_id = public.chainthings_current_tenant_id());

create policy "Tenant isolation for notification_cache"
  on public.chainthings_notification_cache for all
  using (tenant_id = public.chainthings_current_tenant_id());
