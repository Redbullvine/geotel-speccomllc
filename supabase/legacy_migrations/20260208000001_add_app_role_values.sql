do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'PROJECT_MANAGER' and enumtypid = 'public.app_role'::regtype) then
    alter type public.app_role add value 'PROJECT_MANAGER';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'USER_LEVEL_1' and enumtypid = 'public.app_role'::regtype) then
    alter type public.app_role add value 'USER_LEVEL_1';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'USER_LEVEL_2' and enumtypid = 'public.app_role'::regtype) then
    alter type public.app_role add value 'USER_LEVEL_2';
  end if;
end $$;
