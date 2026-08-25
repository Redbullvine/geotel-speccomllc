-- SPEC-COM hard reset: permanently purge legacy role subsystem and keep auth baseline alive.

-- 1) Remove legacy signup/profile trigger paths and role-alignment triggers.
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists trg_profiles_handle_new_auth_user on auth.users;
drop trigger if exists trg_profiles_role_code on public.profiles;
drop trigger if exists trg_project_members_role_code on public.project_members;

-- 2) Remove legacy role helper functions and role transition helpers.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'effective_role_code',
        'role_code_from_legacy',
        'role_code_in',
        'set_role_code_from_legacy',
        'is_owner',
        'is_prime_or_owner',
        'is_admin_or_owner',
        'is_privileged_role',
        'fn_normalize_role_code',
        'fn_role_from_code',
        'fn_upsert_profile_invite',
        'fn_profiles_handle_new_auth_user',
        'fn_admin_diagnostics',
        'current_user_role',
        'current_project_role'
      ])
  loop
    execute format('drop function if exists %s cascade', fn);
  end loop;
end $$;

-- 3) Ensure profile creation remains stable without role defaults.
create or replace function public.fn_create_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (id) do update
    set display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.fn_create_profile();

-- Keep app boot stable: fn_claim_profile_invite no-op baseline implementation.
create or replace function public.fn_claim_profile_invite()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_org_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select p.display_name, p.org_id
    into v_display_name, v_org_id
  from public.profiles p
  where p.id = v_user_id;

  if v_display_name is null then
    insert into public.profiles (id, display_name)
    values (v_user_id, null)
    on conflict (id) do nothing;

    select p.display_name, p.org_id
      into v_display_name, v_org_id
    from public.profiles p
    where p.id = v_user_id;
  end if;

  return jsonb_build_object(
    'id', v_user_id,
    'display_name', v_display_name,
    'org_id', v_org_id
  );
end
$$;

revoke all on function public.fn_claim_profile_invite() from public;
grant execute on function public.fn_claim_profile_invite() to authenticated;

-- 4) Drop all public policies first to break dependencies on legacy role columns.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- 5) Drop legacy role columns where they are role-system artifacts.
alter table if exists public.profiles
  drop column if exists role,
  drop column if exists role_code;

alter table if exists public.project_members
  drop column if exists role,
  drop column if exists role_code;

alter table if exists public.profile_invites
  drop column if exists role_code;

-- 6) Convert any remaining app_role-typed columns to text before dropping enum.
do $$
declare
  c record;
begin
  for c in
    select n.nspname as schema_name, cls.relname as table_name, a.attname as column_name
    from pg_attribute a
    join pg_class cls on cls.oid = a.attrelid
    join pg_namespace n on n.oid = cls.relnamespace
    join pg_type t on t.oid = a.atttypid
    where a.attnum > 0
      and not a.attisdropped
      and n.nspname = 'public'
      and t.typname = 'app_role'
  loop
    execute format(
      'alter table %I.%I alter column %I type text using %I::text',
      c.schema_name,
      c.table_name,
      c.column_name,
      c.column_name
    );
  end loop;
end $$;

drop type if exists public.app_role cascade;
drop type if exists app_role cascade;

-- 7) Disable RLS on public tables for baseline development mode.
do $$
declare
  t record;
begin
  for t in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table %I.%I disable row level security', t.schemaname, t.tablename);
  end loop;
end $$;

notify pgrst, 'reload schema';
