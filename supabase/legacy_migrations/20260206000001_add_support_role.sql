do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'app_role'
      and e.enumlabel = 'SUPPORT'
  ) then
    alter type public.app_role add value 'SUPPORT';
  end if;
end $$;
