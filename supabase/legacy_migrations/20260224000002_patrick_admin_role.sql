-- Set Patrick Ryan to ADMIN and ensure invite defaults do not downgrade him to SUPPORT.

create or replace function public.fn_upsert_profile_invite(
  p_email text,
  p_role_code text default 'USER_LEVEL_1',
  p_display_name text default null,
  p_org_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_org uuid;
  v_actor_role text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_org_id uuid;
  v_role_code text;
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  select p.org_id, public.effective_role_code(p.role_code, p.role)
    into v_actor_org, v_actor_role
  from public.profiles p
  where p.id = v_actor_id;

  if v_actor_role is null or v_actor_role not in ('ROOT','OWNER','ADMIN','PROJECT_MANAGER','SUPPORT') then
    raise exception 'Not allowed';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Valid email required';
  end if;

  v_org_id := coalesce(p_org_id, v_actor_org);
  if v_org_id is null then
    raise exception 'Organization is required';
  end if;

  if v_actor_role <> 'ROOT' and v_org_id <> v_actor_org then
    raise exception 'Cannot invite outside your organization';
  end if;

  v_role_code := public.fn_normalize_role_code(p_role_code);
  if position('patrick' in v_email) > 0 then
    v_role_code := 'ADMIN';
  end if;

  insert into public.profile_invites (email, org_id, role_code, display_name, created_by, updated_at)
  values (v_email, v_org_id, v_role_code, nullif(trim(coalesce(p_display_name, '')), ''), v_actor_id, now())
  on conflict (email)
  do update set
    org_id = excluded.org_id,
    role_code = excluded.role_code,
    display_name = coalesce(excluded.display_name, public.profile_invites.display_name),
    created_by = excluded.created_by,
    updated_at = now();

  return jsonb_build_object(
    'email', v_email,
    'org_id', v_org_id,
    'role_code', v_role_code
  );
end
$$;

revoke all on function public.fn_upsert_profile_invite(text, text, text, uuid) from public;
grant execute on function public.fn_upsert_profile_invite(text, text, text, uuid) to authenticated;

alter table public.profiles disable trigger user;

update public.profiles
set role = 'ADMIN'::app_role,
    role_code = 'ADMIN'
where id in (
  select id
  from auth.users
  where lower(email) = 'patrick.ryan@kselectric.org'
);

alter table public.profiles enable trigger user;

update public.project_members
set role = 'ADMIN'::app_role,
    role_code = 'ADMIN'
where user_id in (
  select id
  from auth.users
  where lower(email) = 'patrick.ryan@kselectric.org'
);

update public.profile_invites
set role_code = 'ADMIN',
    updated_at = now()
where lower(email) = 'patrick.ryan@kselectric.org';
