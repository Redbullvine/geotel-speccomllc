-- Splicer QC/Audit accountability records.
-- Kept separate from field_day_events so office/admin corrections and closeouts
-- never overwrite the original hourly work ledger.

create table if not exists public.field_day_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id uuid references public.field_day_sessions(id) on delete cascade,
  work_date date not null,
  accepted_at timestamptz not null default now(),
  device_user_agent text,
  notice_version text not null default 'recorded_project_day_v1',
  notice_text text,
  created_at timestamptz not null default now()
);

create index if not exists field_day_acceptances_project_date_idx
  on public.field_day_acceptances(project_id, work_date desc, accepted_at desc);

create table if not exists public.splicer_location_closeout_checklists (
  id uuid primary key default gen_random_uuid(),
  project_day_id uuid references public.field_day_sessions(id) on delete cascade,
  location_visit_id uuid references public.field_day_events(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  base_location_id uuid references public.sites(id) on delete set null,
  visit_label text,
  submitted_at timestamptz not null default now(),
  gps_lat numeric,
  gps_lng numeric,
  gps_accuracy_m numeric,
  checklist jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists splicer_closeouts_project_submitted_idx
  on public.splicer_location_closeout_checklists(project_id, submitted_at desc);

create index if not exists splicer_closeouts_visit_idx
  on public.splicer_location_closeout_checklists(location_visit_id);

create table if not exists public.field_time_adjustments (
  id uuid primary key default gen_random_uuid(),
  project_day_id uuid references public.field_day_sessions(id) on delete cascade,
  field_day_event_id uuid references public.field_day_events(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  original_value jsonb not null,
  corrected_value jsonb not null,
  reason text not null,
  admin_user_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists field_time_adjustments_project_idx
  on public.field_time_adjustments(project_id, created_at desc);

alter table public.field_day_acceptances enable row level security;
alter table public.splicer_location_closeout_checklists enable row level security;
alter table public.field_time_adjustments enable row level security;

drop policy if exists "field_day_acceptances_read_authenticated" on public.field_day_acceptances;
create policy "field_day_acceptances_read_authenticated"
on public.field_day_acceptances for select
to authenticated
using (true);

drop policy if exists "field_day_acceptances_insert_self" on public.field_day_acceptances;
create policy "field_day_acceptances_insert_self"
on public.field_day_acceptances for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "splicer_closeouts_read_authenticated" on public.splicer_location_closeout_checklists;
create policy "splicer_closeouts_read_authenticated"
on public.splicer_location_closeout_checklists for select
to authenticated
using (true);

drop policy if exists "splicer_closeouts_insert_self" on public.splicer_location_closeout_checklists;
create policy "splicer_closeouts_insert_self"
on public.splicer_location_closeout_checklists for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "splicer_closeouts_update_self" on public.splicer_location_closeout_checklists;
create policy "splicer_closeouts_update_self"
on public.splicer_location_closeout_checklists for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "field_time_adjustments_read_authenticated" on public.field_time_adjustments;
create policy "field_time_adjustments_read_authenticated"
on public.field_time_adjustments for select
to authenticated
using (true);

drop policy if exists "field_time_adjustments_insert_admin" on public.field_time_adjustments;
create policy "field_time_adjustments_insert_admin"
on public.field_time_adjustments for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and upper(coalesce(p.role, '')) in ('ROOT','OWNER','ADMIN','OFFICE','SUPPORT')
  )
);

grant select, insert on table public.field_day_acceptances to authenticated;
grant select, insert, update on table public.splicer_location_closeout_checklists to authenticated;
grant select, insert on table public.field_time_adjustments to authenticated;

notify pgrst, 'reload schema';
