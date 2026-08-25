-- Project controls for the first live field workflow.
-- Keeps project creation/cleanup tight and makes deletes remove reporting residue.

alter table if exists public.projects
  add column if not exists active boolean not null default true;

create or replace function public.fn_create_project(
  p_name text,
  p_description text,
  p_org_id uuid default null
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
  v_role text;
  v_org_count integer := 0;
  v_only_org uuid := null;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.profiles (id, display_name)
  select v_user_id, split_part(coalesce(u.email, ''), '@', 1)
  from auth.users u
  where u.id = v_user_id
  on conflict (id) do nothing;

  select p.org_id,
         coalesce(nullif(p.display_name, ''), split_part(u.email, '@', 1)),
         upper(coalesce(p.role, ''))
    into v_org_id, v_name, v_role
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = v_user_id;

  if v_role not in ('ROOT','OWNER','ADMIN','OFFICE','SUPPORT') then
    raise exception 'Only admin and office users can create projects';
  end if;

  if p_org_id is not null then
    if v_role <> 'ROOT' and v_org_id is not null and v_org_id <> p_org_id then
      raise exception 'Cannot create project outside your organization';
    end if;
    v_org_id := p_org_id;
  end if;

  if v_org_id is null then
    select count(*), min(o.id::text)::uuid
      into v_org_count, v_only_org
    from public.orgs o;
    if v_org_count = 1 then
      v_org_id := v_only_org;
    end if;
  end if;

  if v_org_id is null then
    begin
      insert into public.orgs (name)
      values (coalesce(nullif(v_name, ''), 'SpecCom Org'))
      returning id into v_org_id;
    exception
      when undefined_column or not_null_violation then
        begin
          execute 'insert into public.orgs (name, role) values ($1, default) returning id'
          into v_org_id
          using coalesce(nullif(v_name, ''), 'SpecCom Org');
        exception
          when others then
            insert into public.orgs (name, role)
            values (coalesce(nullif(v_name, ''), 'SpecCom Org'), 'OWNER')
            returning id into v_org_id;
        end;
    end;
  end if;

  update public.profiles
  set org_id = coalesce(org_id, v_org_id)
  where id = v_user_id;

  insert into public.projects (org_id, name, description, created_by, active)
  values (v_org_id, p_name, p_description, v_user_id, true)
  returning id into v_project_id;

  if to_regclass('public.project_members') is not null then
    begin
      insert into public.project_members (project_id, user_id)
      values (v_project_id, v_user_id)
      on conflict do nothing;
    exception when undefined_column or not_null_violation then
      null;
    end;
  end if;

  return v_project_id;
end;
$$;

create or replace function public.fn_create_project(
  p_name text,
  p_description text
)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select public.fn_create_project(p_name, p_description, null::uuid);
$$;

revoke all on function public.fn_create_project(text,text,uuid) from public;
grant execute on function public.fn_create_project(text,text,uuid) to authenticated;
revoke all on function public.fn_create_project(text,text) from public;
grant execute on function public.fn_create_project(text,text) to authenticated;

create or replace function public.fn_grant_project_access(
  p_project_id uuid,
  p_user_identifier text,
  p_role_code text default 'SPLICER'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_org_id uuid;
  v_project_org_id uuid;
  v_target_user_id uuid;
  v_target_email text;
  v_access_level text := coalesce(nullif(trim(p_role_code), ''), 'SPLICER');
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select upper(coalesce(p.role, '')), p.org_id
    into v_role, v_org_id
  from public.profiles p
  where p.id = v_user_id;

  if v_role not in ('ROOT','OWNER','ADMIN','OFFICE','SUPPORT') then
    raise exception 'Not authorized';
  end if;

  if p_project_id is null then
    raise exception 'Project required';
  end if;

  select pr.org_id
    into v_project_org_id
  from public.projects pr
  where pr.id = p_project_id;

  if v_project_org_id is null then
    raise exception 'Project not found';
  end if;

  if v_role <> 'ROOT' and (v_org_id is null or v_org_id <> v_project_org_id) then
    raise exception 'Not authorized for project org';
  end if;

  if p_user_identifier is null or length(trim(p_user_identifier)) = 0 then
    raise exception 'User required';
  end if;

  begin
    v_target_user_id := trim(p_user_identifier)::uuid;
  exception when invalid_text_representation then
    select u.id, u.email
      into v_target_user_id, v_target_email
    from auth.users u
    where lower(u.email) = lower(trim(p_user_identifier))
    limit 1;
  end;

  if v_target_user_id is not null and v_target_email is null then
    select u.email
      into v_target_email
    from auth.users u
    where u.id = v_target_user_id;
  end if;

  if v_target_user_id is null then
    raise exception 'User not found';
  end if;

  insert into public.profiles (id, display_name, org_id, current_project_id)
  values (v_target_user_id, split_part(coalesce(v_target_email, ''), '@', 1), v_project_org_id, p_project_id)
  on conflict (id) do update
    set org_id = coalesce(public.profiles.org_id, excluded.org_id),
        current_project_id = p_project_id;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project_members'
      and column_name = 'access_level'
  ) then
    insert into public.project_members (project_id, user_id, access_level)
    values (p_project_id, v_target_user_id, v_access_level)
    on conflict do nothing;

    update public.project_members
    set access_level = coalesce(nullif(public.project_members.access_level, ''), v_access_level)
    where project_id = p_project_id
      and user_id = v_target_user_id;
  else
    insert into public.project_members (project_id, user_id)
    values (p_project_id, v_target_user_id)
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'project_id', p_project_id,
    'user_id', v_target_user_id,
    'email', v_target_email,
    'role', v_access_level
  );
end;
$$;

revoke all on function public.fn_grant_project_access(uuid, text, text) from public;
grant execute on function public.fn_grant_project_access(uuid, text, text) to authenticated;

create or replace function public.fn_delete_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_code text;
  v_org_id uuid;
  v_project_org_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select upper(coalesce(p.role, '')), p.org_id
    into v_role_code, v_org_id
  from public.profiles p
  where p.id = v_user_id;

  if v_role_code is null then
    raise exception 'Not authorized';
  end if;

  select pr.org_id
    into v_project_org_id
  from public.projects pr
  where pr.id = p_project_id;

  if v_project_org_id is null then
    raise exception 'Project not found';
  end if;

  if v_role_code = 'ROOT' then
    null;
  elsif v_role_code in ('OWNER','ADMIN','OFFICE','PROJECT_MANAGER','SUPPORT') then
    if v_org_id is null or v_org_id <> v_project_org_id then
      raise exception 'Not authorized for project org';
    end if;
  else
    raise exception 'Not authorized';
  end if;

  if to_regclass('public.field_work_logs') is not null then
    execute 'delete from public.field_work_logs where project_id = $1' using p_project_id;
  end if;

  if to_regclass('public.field_day_events') is not null then
    execute 'delete from public.field_day_events where project_id = $1' using p_project_id;
  end if;

  if to_regclass('public.field_day_sessions') is not null then
    execute 'delete from public.field_day_sessions where project_id = $1' using p_project_id;
  end if;

  if to_regclass('public.field_location_pings') is not null then
    execute 'delete from public.field_location_pings where project_id = $1 or site_id in (select id from public.sites where project_id = $1)' using p_project_id;
  end if;

  if to_regclass('public.daily_progress_reports') is not null then
    execute 'delete from public.daily_progress_reports where project_id = $1' using p_project_id;
  end if;

  if to_regclass('public.material_usage') is not null then
    execute 'delete from public.material_usage where project_id = $1' using p_project_id;
  end if;

  if to_regclass('public.material_requirements') is not null then
    execute 'delete from public.material_requirements where project_id = $1' using p_project_id;
  end if;

  if to_regclass('public.site_billing_codes') is not null then
    execute 'delete from public.site_billing_codes where site_id in (select id from public.sites where project_id = $1)' using p_project_id;
  end if;

  if to_regclass('public.site_codes') is not null then
    execute 'delete from public.site_codes where site_id in (select id from public.sites where project_id = $1)' using p_project_id;
  end if;

  if to_regclass('public.field_photos') is not null then
    execute 'delete from public.field_photos where project_id = $1' using p_project_id;
  end if;

  delete from public.site_media
  where site_id in (select id from public.sites where project_id = p_project_id);

  delete from public.site_entries
  where site_id in (select id from public.sites where project_id = p_project_id);

  if to_regclass('public.entries') is not null then
    execute 'delete from public.entries where project_id = $1' using p_project_id;
  end if;

  if to_regclass('public.work_orders') is not null then
    execute 'delete from public.work_orders where project_id = $1' using p_project_id;
  end if;

  delete from public.sites
  where project_id = p_project_id;

  if to_regclass('public.nodes') is not null then
    execute 'delete from public.nodes where project_id = $1' using p_project_id;
  end if;

  if to_regclass('public.project_members') is not null then
    delete from public.project_members
    where project_id = p_project_id;
  end if;

  delete from public.projects
  where id = p_project_id;
end;
$$;

revoke all on function public.fn_delete_project(uuid) from public;
grant execute on function public.fn_delete_project(uuid) to authenticated;

notify pgrst, 'reload schema';
