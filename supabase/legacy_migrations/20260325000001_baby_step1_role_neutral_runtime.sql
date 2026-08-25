-- Baby Step 1: neutralize active runtime role dependencies.
-- Forward-only override of active objects. No membership model introduced.

-- 1) Ensure profile creation is role-neutral.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.fn_create_profile();

-- 2) Keep invite-claim path role-neutral and non-blocking.
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

  insert into public.profiles (id, display_name)
  select v_user_id, split_part(coalesce(u.email, ''), '@', 1)
  from auth.users u
  where u.id = v_user_id
  on conflict (id) do nothing;

  select p.display_name, p.org_id
    into v_display_name, v_org_id
  from public.profiles p
  where p.id = v_user_id;

  return jsonb_build_object(
    'id', v_user_id,
    'display_name', v_display_name,
    'org_id', v_org_id
  );
end
$$;

revoke all on function public.fn_claim_profile_invite() from public;
grant execute on function public.fn_claim_profile_invite() to authenticated;

-- 3) Replace create-project path with authenticated + org baseline.
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
      -- Keep project creation non-blocking in neutral baseline mode.
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

-- 4) Remove active runtime dependence on legacy role helper functions.
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
        'current_user_role',
        'current_project_role'
      ])
  loop
    execute format('drop function if exists %s cascade', fn);
  end loop;
end $$;

-- 5) Neutralize legacy invoice visibility trigger that depended on role helpers.
create or replace function public.fn_guard_profile_invoice_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Baby Step 1 baseline: role-free and non-blocking.
  return new;
end;
$$;

-- 6) Rebuild active K&S invoice policies to authenticated + org baseline.
alter table public.ks_invoice_import_batches enable row level security;
alter table public.ks_invoice_records enable row level security;

drop policy if exists ks_invoice_batches_select_policy on public.ks_invoice_import_batches;
create policy ks_invoice_batches_select_policy
on public.ks_invoice_import_batches
for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id = ks_invoice_import_batches.org_id
  )
);

drop policy if exists ks_invoice_batches_insert_policy on public.ks_invoice_import_batches;
create policy ks_invoice_batches_insert_policy
on public.ks_invoice_import_batches
for insert
to authenticated
with check (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id = ks_invoice_import_batches.org_id
  )
);

drop policy if exists ks_invoice_batches_update_policy on public.ks_invoice_import_batches;
create policy ks_invoice_batches_update_policy
on public.ks_invoice_import_batches
for update
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id = ks_invoice_import_batches.org_id
  )
)
with check (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id = ks_invoice_import_batches.org_id
  )
);

drop policy if exists ks_invoice_batches_delete_policy on public.ks_invoice_import_batches;
create policy ks_invoice_batches_delete_policy
on public.ks_invoice_import_batches
for delete
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id = ks_invoice_import_batches.org_id
  )
);

drop policy if exists ks_invoice_records_select_policy on public.ks_invoice_records;
create policy ks_invoice_records_select_policy
on public.ks_invoice_records
for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id = ks_invoice_records.org_id
  )
);

drop policy if exists ks_invoice_records_insert_policy on public.ks_invoice_records;
create policy ks_invoice_records_insert_policy
on public.ks_invoice_records
for insert
to authenticated
with check (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id = ks_invoice_records.org_id
  )
);

drop policy if exists ks_invoice_records_update_policy on public.ks_invoice_records;
create policy ks_invoice_records_update_policy
on public.ks_invoice_records
for update
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id = ks_invoice_records.org_id
  )
)
with check (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id = ks_invoice_records.org_id
  )
);

drop policy if exists ks_invoice_records_delete_policy on public.ks_invoice_records;
create policy ks_invoice_records_delete_policy
on public.ks_invoice_records
for delete
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id = ks_invoice_records.org_id
  )
);

-- 7) Replace active storage policies for invoice-files bucket (no role checks).
drop policy if exists invoice_files_storage_select on storage.objects;
create policy invoice_files_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'invoice-files'
  and auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists invoice_files_storage_insert on storage.objects;
create policy invoice_files_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'invoice-files'
  and auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists invoice_files_storage_delete on storage.objects;
create policy invoice_files_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'invoice-files'
  and auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.org_id::text = (storage.foldername(name))[1]
  )
);

notify pgrst, 'reload schema';
