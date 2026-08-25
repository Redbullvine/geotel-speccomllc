-- Allow SUPPORT to create projects within org scope

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

  select p.org_id,
         public.effective_role_code(p.role_code, p.role),
         coalesce(nullif(p.display_name,''), split_part(u.email,'@',1))
    into v_org_id, v_role_code, v_name
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = v_user_id;

  if not found then
    insert into public.profiles (id, display_name, org_id, role, role_code)
    select v_user_id, split_part(u.email,'@',1), null, 'USER_LEVEL_1'::app_role, 'USER_LEVEL_1'
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

  if v_role_code not in ('ROOT','OWNER','ADMIN','PROJECT_MANAGER','SUPPORT') then
    raise exception 'Not authorized';
  end if;

  if p_org_id is not null then
    if v_role_code = 'ROOT' then
      v_org_id := p_org_id;
    elsif v_org_id is null or v_org_id <> p_org_id then
      raise exception 'Cannot create project outside your organization';
    end if;
  end if;

  if v_org_id is null then
    if v_role_code = 'ROOT' then
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
    else
      raise exception 'Profile organization is required';
    end if;
  end if;

  insert into public.projects (org_id, name, description, created_by)
  values (v_org_id, p_name, p_description, v_user_id)
  returning id into v_project_id;

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

notify pgrst, 'reload schema';