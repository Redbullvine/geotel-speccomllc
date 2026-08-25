-- Field work location logging.
-- Captures automatic GPS pings from the truck marker and intentional work notes
-- at saved project locations for daily progress reports.

create extension if not exists pgcrypto;

create table if not exists public.field_location_pings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete set null,
  site_id uuid null references public.sites(id) on delete set null,
  work_date date not null,
  captured_at timestamptz not null default now(),
  gps_lat double precision not null,
  gps_lng double precision not null,
  gps_accuracy_m double precision null,
  nearest_distance_m double precision null,
  source text not null default 'truck_gps',
  created_at timestamptz not null default now()
);

create index if not exists field_location_pings_project_date_idx
  on public.field_location_pings(project_id, work_date, captured_at desc);

create index if not exists field_location_pings_user_date_idx
  on public.field_location_pings(user_id, work_date, captured_at desc);

create index if not exists field_location_pings_site_date_idx
  on public.field_location_pings(site_id, work_date, captured_at desc);

create table if not exists public.field_work_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  site_id uuid null references public.sites(id) on delete set null,
  work_date date not null,
  arrived_at timestamptz null,
  completed_at timestamptz not null default now(),
  gps_lat double precision null,
  gps_lng double precision null,
  gps_accuracy_m double precision null,
  nearest_distance_m double precision null,
  status_before text null,
  status_after text null,
  work_completed text null,
  work_codes text[] not null default '{}'::text[],
  materials_used jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists field_work_logs_project_date_idx
  on public.field_work_logs(project_id, work_date, completed_at desc);

create index if not exists field_work_logs_site_date_idx
  on public.field_work_logs(site_id, work_date, completed_at desc);

create index if not exists field_work_logs_user_date_idx
  on public.field_work_logs(user_id, work_date, completed_at desc);

create or replace function public.set_field_work_logs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_field_work_logs_updated_at on public.field_work_logs;
create trigger trg_field_work_logs_updated_at
before update on public.field_work_logs
for each row execute function public.set_field_work_logs_updated_at();

alter table public.field_location_pings enable row level security;
alter table public.field_work_logs enable row level security;

drop policy if exists "field_location_pings_read_authenticated" on public.field_location_pings;
create policy "field_location_pings_read_authenticated"
on public.field_location_pings for select
to authenticated
using (auth.uid() is not null);

drop policy if exists "field_location_pings_insert_self" on public.field_location_pings;
create policy "field_location_pings_insert_self"
on public.field_location_pings for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "field_work_logs_read_authenticated" on public.field_work_logs;
create policy "field_work_logs_read_authenticated"
on public.field_work_logs for select
to authenticated
using (auth.uid() is not null);

drop policy if exists "field_work_logs_insert_self" on public.field_work_logs;
create policy "field_work_logs_insert_self"
on public.field_work_logs for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "field_work_logs_update_self" on public.field_work_logs;
create policy "field_work_logs_update_self"
on public.field_work_logs for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert on table public.field_location_pings to authenticated;
grant select, insert, update on table public.field_work_logs to authenticated;

notify pgrst, 'reload schema';
