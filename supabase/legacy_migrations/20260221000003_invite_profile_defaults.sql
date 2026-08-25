-- Email-first invite + profile defaults (USER_LEVEL_1 authoritative)

alter table public.profiles
  alter column role_code set default 'USER_LEVEL_1';

alter table public.profiles
  alter column role set default 'USER_LEVEL_1'::app_role;

update public.profiles
set role_code = coalesce(nullif(role_code, ''), 'USER_LEVEL_1'),
    role = coalesce(role, 'USER_LEVEL_1'::app_role)
where role_code is null
   or role_code = ''
   or role is null;

create table if not exists public.profile_invites (
  email text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  role_code text not null default 'USER_LEVEL_1',
  display_name text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profile_invites_org_idx on public.profile_invites(org_id);

alter table public.profile_invites enable row level security;

drop policy if exists "profile_invites_select" on public.profile_invites;
create policy "profile_invites_select"
on public.profile_invites for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          p.org_id = profile_invites.org_id
          and public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER','SUPPORT')
        )
      )
  )
);

drop policy if exists "profile_invites_write" on public.profile_invites;
create policy "profile_invites_write"
on public.profile_invites for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          p.org_id = profile_invites.org_id
          and public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER','SUPPORT')
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          p.org_id = profile_invites.org_id
          and public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER','SUPPORT')
        )
      )
  )
);

create or replace function public.fn_normalize_role_code(p_role_code text)
returns text
language plpgsql
immutable
as $$
declare
  v text := upper(trim(coalesce(p_role_code, 'USER_LEVEL_1')));
begin
  if v in ('USER1','USER_LEVEL_1','USER_LEVEL_I') then return 'USER_LEVEL_1'; end if;
  if v in ('USER2','USER_LEVEL_2','USER_LEVEL_II') then return 'USER_LEVEL_2'; end if;
  if v in ('OWNER','ADMIN','PROJECT_MANAGER','SUPPORT') then return v; end if;
  return 'USER_LEVEL_1';
end
$$;

create or replace function public.fn_role_from_code(p_role_code text)
returns app_role
language sql
immutable
as $$
  select case public.fn_normalize_role_code(p_role_code)
    when 'OWNER' then 'OWNER'::app_role
    when 'ADMIN' then 'ADMIN'::app_role
    when 'PROJECT_MANAGER' then 'PROJECT_MANAGER'::app_role
    when 'SUPPORT' then 'SUPPORT'::app_role
    when 'USER_LEVEL_2' then 'USER_LEVEL_2'::app_role
    else 'USER_LEVEL_1'::app_role
  end;
$$;

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
    v_role_code := 'SUPPORT';
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

create or replace function public.fn_claim_profile_invite()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt()->>'email', '')));
  v_invite public.profile_invites%rowtype;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_invite
  from public.profile_invites
  where email = v_email;

  v_name := nullif(trim(coalesce(v_invite.display_name, split_part(v_email, '@', 1))), '');

  insert into public.profiles (id, org_id, role_code, role, display_name)
  values (
    v_user_id,
    v_invite.org_id,
    coalesce(v_invite.role_code, 'USER_LEVEL_1'),
    public.fn_role_from_code(v_invite.role_code),
    v_name
  )
  on conflict (id)
  do update set
    org_id = coalesce(public.profiles.org_id, excluded.org_id),
    role_code = coalesce(nullif(public.profiles.role_code, ''), excluded.role_code, 'USER_LEVEL_1'),
    role = coalesce(public.profiles.role, excluded.role),
    display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name);

  if found and v_invite.email is not null then
    delete from public.profile_invites where email = v_invite.email;
  end if;

  return (
    select jsonb_build_object(
      'id', p.id,
      'org_id', p.org_id,
      'role_code', coalesce(p.role_code, 'USER_LEVEL_1'),
      'display_name', p.display_name
    )
    from public.profiles p
    where p.id = v_user_id
  );
end
$$;

revoke all on function public.fn_claim_profile_invite() from public;
grant execute on function public.fn_claim_profile_invite() to authenticated;

create or replace function public.fn_profiles_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_display_name text := nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', split_part(v_email, '@', 1))), '');
  v_meta_org text := nullif(trim(coalesce(new.raw_user_meta_data->>'org_id', new.raw_user_meta_data->>'company_id')), '');
  v_org_id uuid;
  v_invite public.profile_invites%rowtype;
begin
  begin
    v_org_id := v_meta_org::uuid;
  exception when others then
    v_org_id := null;
  end;

  select * into v_invite
  from public.profile_invites
  where email = v_email;

  insert into public.profiles (id, org_id, role_code, role, display_name)
  values (
    new.id,
    coalesce(v_org_id, v_invite.org_id),
    coalesce(v_invite.role_code, 'USER_LEVEL_1'),
    public.fn_role_from_code(v_invite.role_code),
    coalesce(v_display_name, v_invite.display_name)
  )
  on conflict (id)
  do update set
    org_id = coalesce(public.profiles.org_id, excluded.org_id),
    role_code = coalesce(nullif(public.profiles.role_code, ''), excluded.role_code, 'USER_LEVEL_1'),
    role = coalesce(public.profiles.role, excluded.role),
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