-- Ensure pgcrypto available for gen_random_uuid if needed
create extension if not exists pgcrypto;

-- Helper: is_admin_or_owner()
create or replace function public.is_admin_or_owner()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('ADMIN','OWNER')
  );
$$;

-- Ensure projects has org_id (aligns with org-based RLS)
alter table public.projects
  add column if not exists org_id uuid references public.orgs(id);

-- Backfill org_id for existing rows when possible
update public.projects proj
set org_id = prof.org_id
from public.profiles prof
where proj.org_id is null
  and proj.created_by = prof.id
  and prof.org_id is not null;

-- Main RPC: create project and auto-bootstrap org for first-day users
create or replace function public.fn_create_project(
  p_clarity_id text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_project_id uuid;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Load current org + name
  select p.org_id, coalesce(nullif(p.display_name,''), split_part(u.email,'@',1))
    into v_org_id, v_name
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = v_user_id;

  if not found then
    -- If profile row missing, create it (fallback)
    insert into public.profiles (id, display_name, role, org_id)
    select v_user_id, split_part(u.email,'@',1), 'TECHNICIAN', null
    from auth.users u
    where u.id = v_user_id
    on conflict (id) do nothing;

    select p.org_id, coalesce(nullif(p.display_name,''), split_part(u.email,'@',1))
      into v_org_id, v_name
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = v_user_id;
  end if;

  -- If user has no org yet, create one and assign them as OWNER
  if v_org_id is null then
    begin
      insert into public.orgs (name, role)
      values (concat(v_name, ' Org'), 'OWNER')
      returning id into v_org_id;
    exception when unique_violation then
      insert into public.orgs (name, role)
      values (concat(v_name, ' Org ', left(v_user_id::text, 8)), 'OWNER')
      returning id into v_org_id;
    end;

    update public.profiles
    set org_id = v_org_id,
        role = case when role::text in ('ADMIN','OWNER') then role else 'OWNER' end
    where id = v_user_id;
  end if;

  -- Create project in that org (p_clarity_id maps to project name in this schema)
  insert into public.projects (org_id, name, description, created_by)
  values (v_org_id, p_clarity_id, p_description, v_user_id)
  returning id into v_project_id;

  return v_project_id;
end;
$$;

-- Lock down execute to authenticated
revoke all on function public.fn_create_project(text,text) from public;
grant execute on function public.fn_create_project(text,text) to authenticated;

-- RLS: Ensure projects table allows selects/inserts safely (minimal, strict)
alter table public.projects enable row level security;

drop policy if exists "projects_select_same_org" on public.projects;
create policy "projects_select_same_org"
on public.projects
for select
to authenticated
using (
  org_id = (select org_id from public.profiles where id = auth.uid())
);

-- Direct inserts should be blocked; force RPC usage:
drop policy if exists "projects_insert_block" on public.projects;
create policy "projects_insert_block"
on public.projects
for insert
to authenticated
with check (false);

-- Remove permissive legacy policies if present
 drop policy if exists "projects_read_all_authed" on public.projects;
 drop policy if exists "projects_write_all_authed" on public.projects;
 drop policy if exists "projects_write_owner_prime_admin_tds" on public.projects;
