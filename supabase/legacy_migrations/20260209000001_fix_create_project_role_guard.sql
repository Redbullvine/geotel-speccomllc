-- Allow project creation to assign membership without client-side role changes
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
  v_role_code text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Load current org + name + effective role
  select p.org_id,
         public.effective_role_code(p.role_code, p.role),
         coalesce(nullif(p.display_name,''), split_part(u.email,'@',1))
    into v_org_id, v_role_code, v_name
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = v_user_id;

  if not found then
    -- If profile row missing, create it (fallback) without role changes
    insert into public.profiles (id, display_name, org_id)
    select v_user_id, split_part(u.email,'@',1), null
    from auth.users u
    where u.id = v_user_id
    on conflict (id) do nothing;

    select p.org_id,
           public.effective_role_code(p.role_code, p.role),
           coalesce(nullif(p.display_name,''), split_part(u.email,'@',1))
      into v_org_id, v_role_code, v_name
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = v_user_id;
  end if;

  if v_role_code not in ('ROOT','OWNER','ADMIN','PROJECT_MANAGER') then
    raise exception 'Not authorized';
  end if;

  -- Prefer supplied org_id when it matches the profile org (or profile org is missing)
  if p_org_id is not null and (v_org_id is null or v_org_id = p_org_id) then
    v_org_id := p_org_id;
  end if;

  -- If user has no org yet, create one and assign org ownership
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
    set org_id = v_org_id
    where id = v_user_id;
  end if;

  -- Create project in that org
  insert into public.projects (org_id, name, description, created_by)
  values (v_org_id, p_name, p_description, v_user_id)
  returning id into v_project_id;

  -- Auto-add creator membership when table exists
  if to_regclass('public.project_members') is not null then
    insert into public.project_members (project_id, user_id, role, role_code)
    values (v_project_id, v_user_id, 'OWNER', 'OWNER')
    on conflict do nothing;
  end if;

  return v_project_id;
end;
$$;

revoke all on function public.fn_create_project(text,text,uuid) from public;
grant execute on function public.fn_create_project(text,text,uuid) to authenticated;
