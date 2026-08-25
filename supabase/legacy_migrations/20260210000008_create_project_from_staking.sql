create or replace function public.fn_create_project_from_staking(
  p_project_name text,
  p_description text,
  p_sites jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_code text;
  v_org_id uuid;
  v_project_id uuid;
  v_site_name text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select public.effective_role_code(p.role_code, p.role), p.org_id
    into v_role_code, v_org_id
  from public.profiles p
  where p.id = v_user_id;

  if v_role_code is null or v_role_code <> 'ROOT' then
    raise exception 'Not authorized';
  end if;

  if p_project_name is null or length(trim(p_project_name)) = 0 then
    raise exception 'Project name required';
  end if;

  insert into public.projects (org_id, name, description, created_by)
  values (v_org_id, trim(p_project_name), nullif(trim(coalesce(p_description, '')), ''), v_user_id)
  returning id into v_project_id;

  if to_regclass('public.project_members') is not null then
    insert into public.project_members (project_id, user_id, role, role_code)
    values (v_project_id, v_user_id, 'ROOT'::app_role, 'ROOT')
    on conflict (project_id, user_id) do update
      set role = excluded.role, role_code = excluded.role_code;
  end if;

  if p_sites is not null and jsonb_typeof(p_sites) = 'array' then
    for v_site_name in select * from jsonb_array_elements_text(p_sites)
    loop
      if v_site_name is null or length(trim(v_site_name)) = 0 then
        continue;
      end if;
      if not exists (
        select 1 from public.sites s
        where s.project_id = v_project_id and lower(s.name) = lower(trim(v_site_name))
      ) then
        insert into public.sites (project_id, name, created_by)
        values (v_project_id, trim(v_site_name), v_user_id);
      end if;
    end loop;
  end if;

  return jsonb_build_object('project_id', v_project_id);
end;
$$;

revoke all on function public.fn_create_project_from_staking(text, text, jsonb) from public;
grant execute on function public.fn_create_project_from_staking(text, text, jsonb) to authenticated;
