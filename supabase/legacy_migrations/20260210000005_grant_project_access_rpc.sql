create or replace function public.fn_grant_project_access(
  p_project_id uuid,
  p_user_identifier text,
  p_role_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_code text;
  v_target_user_id uuid;
  v_role app_role;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select public.effective_role_code(p.role_code, p.role)
    into v_role_code
  from public.profiles p
  where p.id = v_user_id;

  if v_role_code is null or v_role_code <> 'ROOT' then
    raise exception 'Not authorized';
  end if;

  if p_project_id is null then
    raise exception 'Project required';
  end if;

  if p_user_identifier is null or length(trim(p_user_identifier)) = 0 then
    raise exception 'User required';
  end if;

  -- Resolve target user id by UUID or email
  begin
    v_target_user_id := p_user_identifier::uuid;
  exception when invalid_text_representation then
    select u.id
      into v_target_user_id
    from auth.users u
    where lower(u.email) = lower(trim(p_user_identifier));
  end;

  if v_target_user_id is null then
    raise exception 'User not found';
  end if;

  v_role_code := upper(trim(coalesce(p_role_code, 'USER_LEVEL_1')));
  if v_role_code in ('USER1') then v_role_code := 'USER_LEVEL_1'; end if;
  if v_role_code in ('USER2') then v_role_code := 'USER_LEVEL_2'; end if;
  if v_role_code in ('USER_LEVEL_1') then v_role_code := 'USER_LEVEL_I'; end if;
  if v_role_code in ('USER_LEVEL_2') then v_role_code := 'USER_LEVEL_II'; end if;

  if v_role_code not in ('OWNER','ADMIN','PROJECT_MANAGER','USER_LEVEL_I','USER_LEVEL_II','SUPPORT') then
    raise exception 'Invalid role';
  end if;

  v_role := case v_role_code
    when 'OWNER' then 'OWNER'::app_role
    when 'ADMIN' then 'ADMIN'::app_role
    when 'PROJECT_MANAGER' then 'PROJECT_MANAGER'::app_role
    when 'SUPPORT' then 'SUPPORT'::app_role
    when 'USER_LEVEL_I' then 'USER_LEVEL_1'::app_role
    when 'USER_LEVEL_II' then 'USER_LEVEL_2'::app_role
    else 'USER_LEVEL_1'::app_role
  end;

  insert into public.project_members (project_id, user_id, role, role_code)
  values (p_project_id, v_target_user_id, v_role, v_role_code)
  on conflict (project_id, user_id)
  do update set role = excluded.role, role_code = excluded.role_code;

  return jsonb_build_object(
    'project_id', p_project_id,
    'user_id', v_target_user_id,
    'role_code', v_role_code
  );
end;
$$;

revoke all on function public.fn_grant_project_access(uuid, text, text) from public;
grant execute on function public.fn_grant_project_access(uuid, text, text) to authenticated;
