-- Security hardening:
-- 1) Enable RLS on public.app_config with ROOT-only writes.
-- 2) Make flagged views security-invoker.
-- 3) Set explicit search_path on public functions that currently have none.

do $$
begin
  if to_regclass('public.app_config') is not null then
    execute 'alter table public.app_config enable row level security';

    execute 'drop policy if exists app_config_read_authenticated on public.app_config';
    execute 'create policy app_config_read_authenticated
      on public.app_config for select
      to authenticated
      using (true)';

    execute 'drop policy if exists app_config_write_root on public.app_config';
    execute 'create policy app_config_write_root
      on public.app_config for all
      to authenticated
      using (
        exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and public.effective_role_code(p.role_code, p.role) = ''ROOT''
        )
      )
      with check (
        exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and public.effective_role_code(p.role_code, p.role) = ''ROOT''
        )
      )';
  else
    raise notice 'public.app_config not found; skipping RLS hardening';
  end if;
end $$;

do $$
begin
  if to_regclass('public.location_proof_status') is not null then
    execute 'alter view public.location_proof_status set (security_invoker = true)';
  else
    raise notice 'public.location_proof_status not found; skipping';
  end if;

  if to_regclass('public.node_billing_ready') is not null then
    execute 'alter view public.node_billing_ready set (security_invoker = true)';
  else
    raise notice 'public.node_billing_ready not found; skipping';
  end if;
end $$;

do $$
declare
  r record;
begin
  -- Lock search_path for user-defined public functions that currently omit it.
  for r in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as function_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and (
        p.proconfig is null
        or not exists (
          select 1
          from unnest(p.proconfig) cfg
          where cfg like 'search_path=%'
        )
      )
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public, auth, extensions',
      r.schema_name,
      r.function_name,
      r.function_args
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
