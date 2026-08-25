-- Restore invite system using the new role text column.
-- The reset migration dropped the app_role enum and role_code column.
-- These functions now use the role text column added in migration 20260410000010.

-- 1. Add role column to profile_invites (was dropped with the enum)
alter table public.profile_invites
  add column if not exists role text not null default 'SPLICER';

alter table public.profile_invites
  drop constraint if exists profile_invites_role_valid;

alter table public.profile_invites
  add constraint profile_invites_role_valid
  check (role in ('ROOT','OWNER','ADMIN','PRIME','TDS','SUB','SPLICER','TECHNICIAN'));

-- 2. Restore RLS policies using simple role text checks
alter table public.profile_invites enable row level security;

drop policy if exists "profile_invites_select" on public.profile_invites;
create policy "profile_invites_select" on public.profile_invites
  for select to authenticated using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'ROOT'
          or (p.org_id = profile_invites.org_id and p.role in ('ADMIN','OWNER'))
        )
    )
  );

drop policy if exists "profile_invites_write" on public.profile_invites;
create policy "profile_invites_write" on public.profile_invites
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'ROOT'
          or (p.org_id = profile_invites.org_id and p.role in ('ADMIN','OWNER'))
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'ROOT'
          or (p.org_id = profile_invites.org_id and p.role in ('ADMIN','OWNER'))
        )
    )
  );

-- 3. fn_upsert_profile_invite — called by ADMIN/ROOT when inviting a user
create or replace function public.fn_upsert_profile_invite(
  p_email       text,
  p_role        text    default 'SPLICER',
  p_display_name text   default null,
  p_org_id      uuid   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id   uuid := auth.uid();
  v_actor_org  uuid;
  v_actor_role text;
  v_email      text := lower(trim(coalesce(p_email, '')));
  v_org_id     uuid;
  v_role       text := upper(trim(coalesce(p_role, 'SPLICER')));
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  select p.org_id, p.role
    into v_actor_org, v_actor_role
  from public.profiles p
  where p.id = v_actor_id;

  if v_actor_role not in ('ROOT','ADMIN','OWNER') then
    raise exception 'Not authorized — must be ROOT, ADMIN, or OWNER';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Valid email required';
  end if;

  if v_role not in ('ROOT','OWNER','ADMIN','PRIME','TDS','SUB','SPLICER','TECHNICIAN') then
    v_role := 'SPLICER';
  end if;

  -- Only ROOT can invite ROOT
  if v_role = 'ROOT' and v_actor_role <> 'ROOT' then
    raise exception 'Only ROOT can assign the ROOT role';
  end if;

  v_org_id := coalesce(p_org_id, v_actor_org);
  if v_org_id is null then
    raise exception 'Organization is required';
  end if;

  -- Non-ROOT cannot invite outside their org
  if v_actor_role <> 'ROOT' and v_org_id <> v_actor_org then
    raise exception 'Cannot invite outside your organization';
  end if;

  insert into public.profile_invites (email, org_id, role, display_name, created_by, updated_at)
  values (
    v_email, v_org_id, v_role,
    nullif(trim(coalesce(p_display_name, '')), ''),
    v_actor_id, now()
  )
  on conflict (email) do update set
    org_id       = excluded.org_id,
    role         = excluded.role,
    display_name = coalesce(excluded.display_name, public.profile_invites.display_name),
    created_by   = excluded.created_by,
    updated_at   = now();

  return jsonb_build_object(
    'email',  v_email,
    'org_id', v_org_id,
    'role',   v_role
  );
end
$$;

revoke all on function public.fn_upsert_profile_invite(text, text, text, uuid) from public;
grant execute on function public.fn_upsert_profile_invite(text, text, text, uuid) to authenticated;

-- 4. fn_claim_profile_invite — called at login to apply invite to the user's profile
create or replace function public.fn_claim_profile_invite()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email   text := lower(trim(coalesce(auth.jwt()->>'email', '')));
  v_invite  public.profile_invites%rowtype;
  v_name    text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_invite
  from public.profile_invites
  where email = v_email;

  if v_invite.email is null then
    -- No invite — return current profile state
    return (
      select jsonb_build_object(
        'id', p.id, 'org_id', p.org_id, 'role', p.role, 'display_name', p.display_name
      )
      from public.profiles p where p.id = v_user_id
    );
  end if;

  v_name := nullif(trim(coalesce(v_invite.display_name, split_part(v_email, '@', 1))), '');

  insert into public.profiles (id, org_id, role, display_name)
  values (v_user_id, v_invite.org_id, v_invite.role, v_name)
  on conflict (id) do update set
    org_id       = coalesce(public.profiles.org_id, excluded.org_id),
    role         = coalesce(
                     case when public.profiles.role in ('SPLICER') then null else public.profiles.role end,
                     excluded.role,
                     'SPLICER'
                   ),
    display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name);

  delete from public.profile_invites where email = v_invite.email;

  return (
    select jsonb_build_object(
      'id', p.id, 'org_id', p.org_id, 'role', p.role, 'display_name', p.display_name
    )
    from public.profiles p where p.id = v_user_id
  );
end
$$;

revoke all on function public.fn_claim_profile_invite() from public;
grant execute on function public.fn_claim_profile_invite() to authenticated;

-- 5. Auth trigger — auto-claims invite on new user creation
create or replace function public.fn_profiles_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email        text := lower(trim(coalesce(new.email, '')));
  v_display_name text := nullif(trim(coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'full_name',
    split_part(v_email, '@', 1)
  )), '');
  v_meta_role    text := upper(trim(coalesce(new.raw_user_meta_data->>'role', '')));
  v_invite       public.profile_invites%rowtype;
  v_role         text;
begin
  select * into v_invite
  from public.profile_invites
  where email = v_email;

  -- Role priority: invite > metadata > default SPLICER
  if v_invite.email is not null then
    v_role := coalesce(v_invite.role, 'SPLICER');
  elsif v_meta_role in ('ROOT','OWNER','ADMIN','PRIME','TDS','SUB','SPLICER','TECHNICIAN') then
    v_role := v_meta_role;
  else
    v_role := 'SPLICER';
  end if;

  insert into public.profiles (id, org_id, role, display_name)
  values (
    new.id,
    coalesce(v_invite.org_id, null),
    v_role,
    coalesce(v_display_name, v_invite.display_name)
  )
  on conflict (id) do update set
    org_id       = coalesce(public.profiles.org_id, excluded.org_id),
    role         = coalesce(
                     case when public.profiles.role = 'SPLICER' then null else public.profiles.role end,
                     excluded.role, 'SPLICER'
                   ),
    display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name);

  if v_invite.email is not null then
    delete from public.profile_invites where email = v_invite.email;
  end if;

  return new;
end
$$;

drop trigger if exists trg_profiles_handle_new_auth_user on auth.users;
create trigger trg_profiles_handle_new_auth_user
  after insert on auth.users
  for each row
  execute function public.fn_profiles_handle_new_auth_user();

notify pgrst, 'reload schema';
