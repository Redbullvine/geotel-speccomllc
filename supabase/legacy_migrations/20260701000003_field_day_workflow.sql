-- Guided project-day workflow for field crews.
-- A session is Andrew's full project day; events are VI, location work, breaks,
-- lunch, and other day segments.

create extension if not exists pgcrypto;

create table if not exists public.field_day_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_date date not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  total_minutes integer not null default 0,
  start_gps_lat double precision null,
  start_gps_lng double precision null,
  start_gps_accuracy_m double precision null,
  end_gps_lat double precision null,
  end_gps_lng double precision null,
  end_gps_accuracy_m double precision null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists field_day_sessions_project_date_idx
  on public.field_day_sessions(project_id, work_date desc, started_at desc);

create index if not exists field_day_sessions_user_date_idx
  on public.field_day_sessions(user_id, work_date desc, started_at desc);

create table if not exists public.field_day_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.field_day_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  site_id uuid null references public.sites(id) on delete set null,
  event_type text not null,
  label text null,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  duration_minutes integer not null default 0,
  gps_lat double precision null,
  gps_lng double precision null,
  gps_accuracy_m double precision null,
  site_lat double precision null,
  site_lng double precision null,
  notes text null,
  work_codes text[] not null default '{}'::text[],
  materials_used jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists field_day_events_session_idx
  on public.field_day_events(session_id, started_at);

create index if not exists field_day_events_project_date_idx
  on public.field_day_events(project_id, started_at desc);

create index if not exists field_day_events_site_idx
  on public.field_day_events(site_id, started_at desc);

create or replace function public.set_field_day_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_field_day_sessions_updated_at on public.field_day_sessions;
create trigger trg_field_day_sessions_updated_at
before update on public.field_day_sessions
for each row execute function public.set_field_day_updated_at();

drop trigger if exists trg_field_day_events_updated_at on public.field_day_events;
create trigger trg_field_day_events_updated_at
before update on public.field_day_events
for each row execute function public.set_field_day_updated_at();

alter table public.field_day_sessions enable row level security;
alter table public.field_day_events enable row level security;

drop policy if exists "field_day_sessions_read_authenticated" on public.field_day_sessions;
create policy "field_day_sessions_read_authenticated"
on public.field_day_sessions for select
to authenticated
using (auth.uid() is not null);

drop policy if exists "field_day_sessions_insert_self" on public.field_day_sessions;
create policy "field_day_sessions_insert_self"
on public.field_day_sessions for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "field_day_sessions_update_self" on public.field_day_sessions;
create policy "field_day_sessions_update_self"
on public.field_day_sessions for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "field_day_events_read_authenticated" on public.field_day_events;
create policy "field_day_events_read_authenticated"
on public.field_day_events for select
to authenticated
using (auth.uid() is not null);

drop policy if exists "field_day_events_insert_self" on public.field_day_events;
create policy "field_day_events_insert_self"
on public.field_day_events for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "field_day_events_update_self" on public.field_day_events;
create policy "field_day_events_update_self"
on public.field_day_events for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on table public.field_day_sessions to authenticated;
grant select, insert, update on table public.field_day_events to authenticated;

notify pgrst, 'reload schema';
