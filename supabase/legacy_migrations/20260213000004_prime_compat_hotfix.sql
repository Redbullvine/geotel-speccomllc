do $$
begin
  if exists (select 1 from pg_type where typname = 'app_role') then
    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'app_role'
        and e.enumlabel = 'PRIME'
    ) then
      alter type public.app_role add value 'PRIME';
    end if;
  end if;
end $$;

create or replace function public.role_code_from_legacy(p_role app_role)
returns text
language sql
stable
as $$
  select case p_role::text
    when 'ROOT' then 'ROOT'
    when 'OWNER' then 'OWNER'
    when 'ADMIN' then 'ADMIN'
    when 'PROJECT_MANAGER' then 'PROJECT_MANAGER'
    when 'PM' then 'PROJECT_MANAGER'
    when 'PRIME' then 'PROJECT_MANAGER'
    when 'SUPPORT' then 'SUPPORT'
    when 'USER_LEVEL_2' then 'USER_LEVEL_2'
    when 'USER_LEVEL_1' then 'USER_LEVEL_1'
    when 'USER2' then 'USER_LEVEL_2'
    when 'USER1' then 'USER_LEVEL_1'
    when 'TECHNICIAN' then 'USER_LEVEL_1'
    else 'USER_LEVEL_1'
  end;
$$;

notify pgrst, 'reload schema';
