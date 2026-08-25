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

  select public.effective_role_code(p.role_code, p.role), p.org_id
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
  elsif v_role_code in ('OWNER','ADMIN','PROJECT_MANAGER','SUPPORT') then
    if v_org_id is null or v_org_id <> v_project_org_id then
      raise exception 'Not authorized for project org';
    end if;
  else
    raise exception 'Not authorized';
  end if;

  delete from public.site_media
  where site_id in (select id from public.sites where project_id = p_project_id);

  delete from public.site_entries
  where site_id in (select id from public.sites where project_id = p_project_id);

  if to_regclass('public.entries') is not null then
    execute 'delete from public.entries where project_id = $1' using p_project_id;
  end if;

  delete from public.sites
  where project_id = p_project_id;

  delete from public.project_members
  where project_id = p_project_id;

  delete from public.projects
  where id = p_project_id;
end;
$$;

revoke all on function public.fn_delete_project(uuid) from public;
grant execute on function public.fn_delete_project(uuid) to authenticated;

notify pgrst, 'reload schema';
