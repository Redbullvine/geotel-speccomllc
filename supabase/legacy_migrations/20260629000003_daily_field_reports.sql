-- Daily field reports: saved project/day snapshots for office review.
-- Stores locations worked, proof photos, material usage, and splicing/billing codes.

create extension if not exists pgcrypto;

create table if not exists public.daily_progress_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null,
  created_by uuid not null references auth.users(id),
  submitted_by uuid null references auth.users(id),
  submitted_at timestamptz not null default now(),
  summary text null,
  metrics jsonb not null default '{}'::jsonb,
  comments text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, report_date)
);

alter table public.daily_progress_reports
  add column if not exists submitted_by uuid references auth.users(id),
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists summary text;

create index if not exists daily_progress_reports_project_date_idx
  on public.daily_progress_reports(project_id, report_date desc);

create index if not exists daily_progress_reports_created_by_idx
  on public.daily_progress_reports(created_by);

create index if not exists daily_progress_reports_submitted_by_idx
  on public.daily_progress_reports(submitted_by);

create or replace function public.set_daily_progress_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_daily_progress_reports_updated_at on public.daily_progress_reports;
create trigger trg_daily_progress_reports_updated_at
before update on public.daily_progress_reports
for each row execute function public.set_daily_progress_reports_updated_at();

alter table public.daily_progress_reports enable row level security;

drop policy if exists "dpr_select_project_members" on public.daily_progress_reports;
drop policy if exists "dpr_write_privileged" on public.daily_progress_reports;
drop policy if exists "dpr_update_privileged" on public.daily_progress_reports;
drop policy if exists "daily_reports_read_authenticated" on public.daily_progress_reports;
drop policy if exists "daily_reports_insert_authenticated" on public.daily_progress_reports;
drop policy if exists "daily_reports_update_authenticated" on public.daily_progress_reports;

create policy "daily_reports_read_authenticated"
on public.daily_progress_reports for select
to authenticated
using (true);

create policy "daily_reports_insert_authenticated"
on public.daily_progress_reports for insert
to authenticated
with check (auth.uid() is not null);

create policy "daily_reports_update_authenticated"
on public.daily_progress_reports for update
to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

grant select, insert, update on table public.daily_progress_reports to authenticated;

create or replace function public.fn_build_dpr_metrics(p_project_id uuid, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text := 'America/Chicago';
  v_project_name text := '';
  v_sites_created int := 0;
  v_splice_created int := 0;
  v_work_orders_completed int := 0;
  v_blocked_items int := 0;
  v_site_photos int := 0;
  v_splice_photos int := 0;
  v_material_lines int := 0;
  v_material_units int := 0;
  v_site_entry_lines int := 0;
  v_labor_minutes int := 0;
  v_crew_count int := 0;
  v_locations jsonb := '[]'::jsonb;
  v_splice_locations jsonb := '[]'::jsonb;
  v_material_usage jsonb := '[]'::jsonb;
  v_crew jsonb := '[]'::jsonb;
  v_work_orders jsonb := '[]'::jsonb;
  v_code_count int := 0;
  v_location_count int := 0;
  v_summary text := '';
  v_location_names text := '';
begin
  select coalesce(nullif(p.name, ''), p.id::text)
    into v_project_name
  from public.projects p
  where p.id = p_project_id;

  if v_project_name is null then
    raise exception 'Project not found';
  end if;

  select count(*) into v_sites_created
  from public.sites s
  where s.project_id = p_project_id
    and ((s.created_at at time zone v_tz)::date = p_date);

  select count(*) into v_splice_created
  from public.splice_locations sl
  join public.nodes n on n.id = sl.node_id
  where n.project_id = p_project_id
    and ((sl.created_at at time zone v_tz)::date = p_date);

  select count(*) into v_work_orders_completed
  from public.work_orders wo
  where wo.project_id = p_project_id
    and wo.status::text in ('COMPLETE', 'COMPLETED')
    and ((wo.updated_at at time zone v_tz)::date = p_date);

  select count(*) into v_blocked_items
  from public.work_orders wo
  where wo.project_id = p_project_id
    and wo.status::text = 'BLOCKED'
    and ((wo.updated_at at time zone v_tz)::date = p_date);

  select count(*) into v_site_photos
  from public.site_media sm
  join public.sites s on s.id = sm.site_id
  where s.project_id = p_project_id
    and ((sm.created_at at time zone v_tz)::date = p_date);

  select count(*) into v_splice_photos
  from public.splice_location_photos sp
  join public.splice_locations sl on sl.id = sp.splice_location_id
  join public.nodes n on n.id = sl.node_id
  where n.project_id = p_project_id
    and ((coalesce(sp.taken_at, sp.created_at) at time zone v_tz)::date = p_date);

  select count(*), coalesce(sum(greatest(mu.qty_used, 0)), 0)
    into v_material_lines, v_material_units
  from public.material_usage mu
  where mu.project_id = p_project_id
    and ((mu.used_at at time zone v_tz)::date = p_date);

  select count(*) into v_site_entry_lines
  from public.site_entries se
  join public.sites s on s.id = se.site_id
  where s.project_id = p_project_id
    and ((se.created_at at time zone v_tz)::date = p_date);

  select coalesce(sum(coalesce(t.total_minutes_worked, 0)), 0), count(distinct t.user_id)
    into v_labor_minutes, v_crew_count
  from public.technician_timesheets t
  where t.project_id = p_project_id
    and t.work_date = p_date;

  with worked_sites as (
    select distinct s.*
    from public.sites s
    where s.project_id = p_project_id
      and (
        ((s.created_at at time zone v_tz)::date = p_date)
        or exists (
          select 1 from public.site_media sm
          where sm.site_id = s.id
            and ((sm.created_at at time zone v_tz)::date = p_date)
        )
        or exists (
          select 1 from public.site_codes sc
          where sc.site_id = s.id
            and ((sc.created_at at time zone v_tz)::date = p_date)
        )
        or exists (
          select 1 from public.site_entries se
          where se.site_id = s.id
            and ((se.created_at at time zone v_tz)::date = p_date)
        )
      )
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'site_id', ws.id,
      'name', coalesce(nullif(ws.name, ''), nullif(ws.drop_number, ''), 'Location ' || left(ws.id::text, 8)),
      'notes', ws.notes,
      'work_type', ws.work_type,
      'gps_lat', coalesce(ws.gps_lat, ws.latitude, ws.lat),
      'gps_lng', coalesce(ws.gps_lng, ws.longitude, ws.lng),
      'created_at', ws.created_at,
      'created_by', ws.created_by,
      'created_by_name', coalesce(p.display_name, ws.created_by::text),
      'codes', (
        select coalesce(jsonb_agg(c.code order by c.code), '[]'::jsonb)
        from (
          select distinct nullif(trim(sc.code), '') as code
          from public.site_codes sc
          where sc.site_id = ws.id
        ) c
        where c.code is not null
      ),
      'entries', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'description', se.description,
            'quantity', se.quantity,
            'created_at', se.created_at,
            'created_by', se.created_by
          )
          order by se.created_at
        ), '[]'::jsonb)
        from public.site_entries se
        where se.site_id = ws.id
      ),
      'photos', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', sm.id,
            'path', sm.media_path,
            'created_at', sm.created_at,
            'created_by', sm.created_by,
            'gps_lat', sm.gps_lat,
            'gps_lng', sm.gps_lng
          )
          order by sm.created_at
        ), '[]'::jsonb)
        from public.site_media sm
        where sm.site_id = ws.id
          and ((sm.created_at at time zone v_tz)::date = p_date)
      ),
      'photo_count_today', (
        select count(*)
        from public.site_media sm
        where sm.site_id = ws.id
          and ((sm.created_at at time zone v_tz)::date = p_date)
      )
    )
    order by ws.created_at desc
  ), '[]'::jsonb)
    into v_locations
  from worked_sites ws
  left join public.profiles p on p.id = ws.created_by;

  with worked_splice as (
    select distinct sl.*, n.node_number
    from public.splice_locations sl
    join public.nodes n on n.id = sl.node_id
    where n.project_id = p_project_id
      and (
        ((sl.created_at at time zone v_tz)::date = p_date)
        or ((sl.taken_at at time zone v_tz)::date = p_date)
        or exists (
          select 1 from public.splice_location_photos sp
          where sp.splice_location_id = sl.id
            and ((coalesce(sp.taken_at, sp.created_at) at time zone v_tz)::date = p_date)
        )
      )
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'location_id', ws.id,
      'node_id', ws.node_id,
      'node_number', ws.node_number,
      'label', coalesce(nullif(ws.location_label, ''), nullif(ws.label, ''), ws.id::text),
      'completed', coalesce(ws.completed, false),
      'work_codes', coalesce(to_jsonb(ws.work_codes), '[]'::jsonb),
      'work_description', ws.work_description,
      'gps_lat', ws.gps_lat,
      'gps_lng', ws.gps_lng,
      'created_at', ws.created_at,
      'photos', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', sp.id,
            'slot_key', sp.slot_key,
            'path', sp.photo_path,
            'taken_at', sp.taken_at,
            'created_at', sp.created_at,
            'uploaded_by', sp.uploaded_by,
            'gps_lat', sp.gps_lat,
            'gps_lng', sp.gps_lng
          )
          order by coalesce(sp.taken_at, sp.created_at)
        ), '[]'::jsonb)
        from public.splice_location_photos sp
        where sp.splice_location_id = ws.id
          and ((coalesce(sp.taken_at, sp.created_at) at time zone v_tz)::date = p_date)
      )
    )
    order by ws.created_at desc
  ), '[]'::jsonb)
    into v_splice_locations
  from worked_splice ws;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', mu.id,
      'feature_id', mu.feature_id,
      'item_key', mu.item_key,
      'qty_used', mu.qty_used,
      'used_by', mu.used_by,
      'used_by_name', coalesce(p.display_name, mu.used_by::text),
      'used_at', mu.used_at
    )
    order by mu.used_at
  ), '[]'::jsonb)
    into v_material_usage
  from public.material_usage mu
  left join public.profiles p on p.id = mu.used_by
  where mu.project_id = p_project_id
    and ((mu.used_at at time zone v_tz)::date = p_date);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', t.user_id,
      'name', coalesce(p.display_name, t.user_id::text),
      'clock_in_at', t.clock_in_at,
      'clock_out_at', t.clock_out_at,
      'total_minutes_worked', coalesce(t.total_minutes_worked, 0)
    )
    order by t.clock_in_at
  ), '[]'::jsonb)
    into v_crew
  from public.technician_timesheets t
  left join public.profiles p on p.id = t.user_id
  where t.project_id = p_project_id
    and t.work_date = p_date;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', wo.id,
      'type', wo.type::text,
      'status', wo.status::text,
      'address', wo.address,
      'customer_label', wo.customer_label,
      'assigned_to_user_id', wo.assigned_to_user_id,
      'updated_at', wo.updated_at
    )
    order by wo.updated_at desc
  ), '[]'::jsonb)
    into v_work_orders
  from public.work_orders wo
  where wo.project_id = p_project_id
    and ((wo.updated_at at time zone v_tz)::date = p_date);

  with codes as (
    select distinct lower(trim(value::text)) as code
    from jsonb_array_elements_text(
      coalesce((
        select jsonb_agg(code_value)
        from (
          select jsonb_array_elements_text(coalesce(loc->'codes', '[]'::jsonb)) as code_value
          from jsonb_array_elements(v_locations) loc
          union all
          select jsonb_array_elements_text(coalesce(loc->'work_codes', '[]'::jsonb)) as code_value
          from jsonb_array_elements(v_splice_locations) loc
        ) all_codes
      ), '[]'::jsonb)
    ) value
  )
  select count(*) into v_code_count
  from codes
  where code <> '';

  v_location_count := jsonb_array_length(v_locations) + jsonb_array_length(v_splice_locations);

  select string_agg(name, ', ' order by ord)
    into v_location_names
  from (
    select ord, value->>'name' as name
    from jsonb_array_elements(v_locations) with ordinality as t(value, ord)
    where nullif(value->>'name', '') is not null
    limit 5
  ) names;

  v_summary := format(
    '%s: %s locations worked, %s photos uploaded, %s material units logged, %s codes recorded, %s crew member(s), %s labor hours.',
    v_project_name,
    v_location_count,
    v_site_photos + v_splice_photos,
    v_material_units,
    v_code_count,
    v_crew_count,
    round((v_labor_minutes::numeric / 60.0), 2)
  );

  if coalesce(v_location_names, '') <> '' then
    v_summary := v_summary || ' Locations: ' || v_location_names || '.';
  end if;

  return jsonb_build_object(
    'project_id', p_project_id,
    'project_name', v_project_name,
    'report_date', p_date,
    'summary', v_summary,
    'sites_created_today', v_sites_created,
    'splice_locations_created_today', v_splice_created,
    'work_orders_completed_today', v_work_orders_completed,
    'blocked_items_today', v_blocked_items,
    'photos_uploaded_today', v_site_photos + v_splice_photos,
    'site_photos_uploaded_today', v_site_photos,
    'splice_photos_uploaded_today', v_splice_photos,
    'material_items_used_today', v_material_lines,
    'material_units_used_today', v_material_units,
    'site_entry_lines_today', v_site_entry_lines,
    'code_count_today', v_code_count,
    'labor_minutes_today', v_labor_minutes,
    'labor_hours_today', round((v_labor_minutes::numeric / 60.0), 2),
    'crew_count_today', v_crew_count,
    'locations_worked', v_locations,
    'splice_locations_worked', v_splice_locations,
    'material_usage', v_material_usage,
    'crew', v_crew,
    'work_orders', v_work_orders,
    'generated_at', now()
  );
end;
$$;

create or replace function public.fn_upsert_daily_progress_report(
  p_project_id uuid,
  p_date date,
  p_comments text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_metrics jsonb;
  v_summary text;
  v_report_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  v_metrics := public.fn_build_dpr_metrics(p_project_id, p_date);
  v_summary := nullif(v_metrics->>'summary', '');

  insert into public.daily_progress_reports (
    project_id,
    report_date,
    created_by,
    submitted_by,
    submitted_at,
    summary,
    metrics,
    comments
  ) values (
    p_project_id,
    p_date,
    v_user_id,
    v_user_id,
    now(),
    v_summary,
    v_metrics,
    p_comments
  )
  on conflict (project_id, report_date)
  do update set
    submitted_by = excluded.submitted_by,
    submitted_at = excluded.submitted_at,
    summary = excluded.summary,
    metrics = excluded.metrics,
    comments = coalesce(excluded.comments, public.daily_progress_reports.comments),
    updated_at = now()
  returning id into v_report_id;

  return v_report_id;
end;
$$;

grant execute on function public.fn_build_dpr_metrics(uuid, date) to authenticated;
grant execute on function public.fn_upsert_daily_progress_report(uuid, date, text) to authenticated;

notify pgrst, 'reload schema';
