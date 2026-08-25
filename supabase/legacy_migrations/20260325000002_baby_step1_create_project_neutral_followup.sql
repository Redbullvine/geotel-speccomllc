-- Baby Step 1 follow-up: keep create-project path role-neutral and non-blocking.

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
         coalesce(nullif(p.display_name, ''), split_part(u.email, '@', 1))
    into v_org_id, v_name
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = v_user_id;

  if p_org_id is not null then
    if v_org_id is not null and v_org_id <> p_org_id then
      raise exception 'Cannot create project outside your organization';
    end if;
    v_org_id := p_org_id;
  end if;

  if v_org_id is null and to_regclass('public.project_members') is not null then
    select min(pr.org_id::text)::uuid
      into v_org_id
    from public.project_members pm
    join public.projects pr on pr.id = pm.project_id
    where pm.user_id = v_user_id
      and pr.org_id is not null;
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
            -- Legacy fallback only when org.role is required and has no default.
            insert into public.orgs (name, role)
            values (coalesce(nullif(v_name, ''), 'SpecCom Org'), 'OWNER')
            returning id into v_org_id;
        end;
    end;
  end if;

  update public.profiles
  set org_id = coalesce(org_id, v_org_id)
  where id = v_user_id;

  insert into public.projects (org_id, name, description, created_by)
  values (v_org_id, p_name, p_description, v_user_id)
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

notify pgrst, 'reload schema';
