create or replace function public.fn_admin_diagnostics()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_code text;
  v_profile jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select jsonb_build_object(
    'id', p.id,
    'email', u.email,
    'role', p.role::text,
    'role_code', p.role_code,
    'effective_role_code', public.effective_role_code(p.role_code, p.role),
    'org_id', p.org_id,
    'display_name', p.display_name,
    'preferred_language', p.preferred_language,
    'is_demo', p.is_demo
  )
  into v_profile
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = v_user_id;

  if v_profile is null then
    raise exception 'Profile missing';
  end if;

  v_role_code := coalesce(v_profile->>'effective_role_code', v_profile->>'role_code');

  if v_role_code is null or v_role_code not in ('OWNER','ADMIN','ROOT') then
    raise exception 'Not authorized';
  end if;

  return jsonb_build_object(
    'server_time', now(),
    'user', v_profile
  );
end;
$$;

revoke all on function public.fn_admin_diagnostics() from public;
grant execute on function public.fn_admin_diagnostics() to authenticated;
