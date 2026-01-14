-- SpecCom LIVE workflow hardening (RLS helpers + proof RPCs)
-- Run after base schema + splice_location_photos + billing migrations.

-- Helper functions (SECURITY DEFINER, no recursion)
create or replace function public.current_user_role()
returns app_role
language sql
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select (public.current_user_role() = 'OWNER');
$$;

create or replace function public.is_prime_or_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select (public.current_user_role() in ('PRIME','OWNER'));
$$;

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.project_members enable row level security;

create or replace function public.current_project_role(p_project_id uuid)
returns app_role
language sql
security definer
set search_path = public
as $$
  select role
  from public.project_members
  where project_id = p_project_id and user_id = auth.uid();
$$;

create or replace function public.has_project_access(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid()
  ) or public.is_owner();
$$;

create or replace function public.project_id_for_node(p_node_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select project_id from public.nodes where id = p_node_id;
$$;

create or replace function public.project_id_for_splice_location(p_location_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select n.project_id
  from public.splice_locations sl
  join public.nodes n on n.id = sl.node_id
  where sl.id = p_location_id;
$$;

-- Profiles policies (no recursion in policy)
drop policy if exists "profiles_read_own" on public.profiles;
drop policy if exists "profiles_owner_read_all" on public.profiles;
drop policy if exists "profiles_owner_update" on public.profiles;

create policy "profiles_read_own"
on public.profiles for select
to authenticated
using (auth.uid() = id or public.is_owner());

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (auth.uid() = id or public.is_owner())
with check (auth.uid() = id or public.is_owner());

-- Projects policies
drop policy if exists "projects_read_all_authed" on public.projects;
drop policy if exists "projects_write_owner_prime_tds" on public.projects;
drop policy if exists "projects_update_owner_prime_tds" on public.projects;

create policy "projects_read_members"
on public.projects for select
to authenticated
using (public.has_project_access(id));

create policy "projects_write_owner_prime_tds"
on public.projects for insert
to authenticated
with check (public.is_prime_or_owner() or public.current_user_role() = 'TDS');

create policy "projects_update_owner_prime_tds"
on public.projects for update
to authenticated
using (public.is_prime_or_owner() or public.current_user_role() = 'TDS');

-- Project members policies
create policy "project_members_read"
on public.project_members for select
to authenticated
using (public.has_project_access(project_id));

create policy "project_members_write_owner_prime"
on public.project_members for insert
to authenticated
with check (public.is_prime_or_owner());

create policy "project_members_update_owner_prime"
on public.project_members for update
to authenticated
using (public.is_prime_or_owner());

-- Nodes policies
drop policy if exists "nodes_read_all_authed" on public.nodes;
drop policy if exists "nodes_write_prime_sub_owner" on public.nodes;
drop policy if exists "nodes_update_prime_sub_owner" on public.nodes;

create policy "nodes_read_members"
on public.nodes for select
to authenticated
using (public.has_project_access(project_id));

create policy "nodes_write_members"
on public.nodes for insert
to authenticated
with check (public.has_project_access(project_id));

create policy "nodes_update_members"
on public.nodes for update
to authenticated
using (public.has_project_access(project_id));

-- Splice locations policies
drop policy if exists "splice_locations_read_all_authed" on public.splice_locations;
drop policy if exists "splice_locations_write_job_roles" on public.splice_locations;
drop policy if exists "splice_locations_update_job_roles" on public.splice_locations;

create policy "splice_locations_read_members"
on public.splice_locations for select
to authenticated
using (public.has_project_access(public.project_id_for_splice_location(id)));

create policy "splice_locations_write_members"
on public.splice_locations for insert
to authenticated
with check (public.has_project_access(public.project_id_for_node(node_id)));

create policy "splice_locations_update_members"
on public.splice_locations for update
to authenticated
using (public.has_project_access(public.project_id_for_splice_location(id)));

-- Splice location photos policies
drop policy if exists "splice_location_photos_read_all_authed" on public.splice_location_photos;
drop policy if exists "splice_location_photos_write_job_roles" on public.splice_location_photos;
drop policy if exists "splice_location_photos_update_job_roles" on public.splice_location_photos;

create policy "splice_location_photos_read_members"
on public.splice_location_photos for select
to authenticated
using (public.has_project_access(public.project_id_for_splice_location(splice_location_id)));

create policy "splice_location_photos_write_members"
on public.splice_location_photos for insert
to authenticated
with check (public.has_project_access(public.project_id_for_splice_location(splice_location_id)));

create policy "splice_location_photos_update_members"
on public.splice_location_photos for update
to authenticated
using (public.has_project_access(public.project_id_for_splice_location(splice_location_id)));

-- Alerts policies
drop policy if exists "alerts_read_prime_owner" on public.alerts;
drop policy if exists "alerts_update_prime_owner" on public.alerts;
drop policy if exists "alerts_insert_prime_owner" on public.alerts;

create policy "alerts_read_members"
on public.alerts for select
to authenticated
using (public.is_prime_or_owner() or assigned_to_user_id = auth.uid());

create policy "alerts_write_prime_owner"
on public.alerts for insert
to authenticated
with check (public.is_prime_or_owner());

create policy "alerts_update_prime_owner"
on public.alerts for update
to authenticated
using (public.is_prime_or_owner());

-- Proof status RPCs (using splice_location_photos slots)
create or replace function public.splice_location_proof_status(p_location_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with counts as (
    select
      sum(case when slot_key = 'splice_completion' then 1 else 0 end) as splice_complete,
      sum(case when slot_key like 'port_%' then 1 else 0 end) as port_test
    from public.splice_location_photos
    where splice_location_id = p_location_id
  )
  select jsonb_build_object(
    'port_test', coalesce(port_test, 0),
    'splice_complete', coalesce(splice_complete, 0),
    'is_complete', (coalesce(port_test, 0) >= 1 and coalesce(splice_complete, 0) >= 1)
  )
  from counts;
$$;

create or replace function public.node_proof_status(p_node_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with locs as (
    select id from public.splice_locations where node_id = p_node_id
  ),
  status as (
    select
      l.id,
      (public.splice_location_proof_status(l.id)->>'is_complete')::boolean as is_complete
    from locs l
  ),
  overrides as (
    select
      bool_or(override_type = 'BILLING_UNLOCKED') as billing_unlocked,
      bool_or(override_type = 'BACKFILL_ALLOWED') as backfill_allowed
    from public.owner_overrides
    where node_id = p_node_id
  )
  select jsonb_build_object(
    'total_locations', (select count(*) from locs),
    'complete_locations', (select count(*) from status where is_complete),
    'is_node_complete', (select count(*) from locs) > 0 and (select count(*) from locs) = (select count(*) from status where is_complete),
    'billing_unlocked', coalesce((select billing_unlocked from overrides), false)
      or ((select count(*) from locs) > 0 and (select count(*) from locs) = (select count(*) from status where is_complete)),
    'backfill_allowed', coalesce((select backfill_allowed from overrides), false)
  );
$$;

-- Indexes
create index if not exists project_members_project_id_idx
  on public.project_members (project_id);
create index if not exists splice_location_photos_location_id_idx
  on public.splice_location_photos (splice_location_id);

-- Storage bucket + policies (proof photos)
insert into storage.buckets (id, name, public)
values ('proof-photos','proof-photos', false)
on conflict (id) do nothing;

drop policy if exists "proof_photos_read_authed" on storage.objects;
drop policy if exists "proof_photos_write_authed" on storage.objects;

create policy "proof_photos_read_authed"
on storage.objects for select
to authenticated
using (bucket_id = 'proof-photos');

create policy "proof_photos_write_authed"
on storage.objects for insert
to authenticated
with check (bucket_id = 'proof-photos');
