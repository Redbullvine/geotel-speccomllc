create or replace function public.role_code_from_legacy(p_role app_role)
returns text
language sql
stable
as $$
  select case p_role::text
    when 'ROOT' then 'ROOT'
    when 'OWNER' then 'ADMIN'
    when 'PM' then 'PROJECT_MANAGER'
    when 'USER1' then 'USER_LEVEL_II'
    when 'USER2' then 'USER_LEVEL_I'
    when 'ADMIN' then 'ADMIN'
    when 'TECHNICIAN' then 'USER_LEVEL_I'
    else 'USER_LEVEL_I'
  end;
$$;

create or replace function public.effective_role_code(p_role_code text, p_role app_role)
returns text
language sql
stable
as $$
  select coalesce(p_role_code, public.role_code_from_legacy(p_role));
$$;

alter table public.profiles
  drop constraint if exists profiles_role_code_check;

alter table public.project_members
  drop constraint if exists project_members_role_code_check;

alter table public.profiles
  add constraint profiles_role_code_check
  check (role_code in ('ROOT','ADMIN','PROJECT_MANAGER','USER_LEVEL_I','USER_LEVEL_II','SUPPORT'));

alter table public.project_members
  add constraint project_members_role_code_check
  check (role_code in ('ROOT','ADMIN','PROJECT_MANAGER','USER_LEVEL_I','USER_LEVEL_II','SUPPORT'));

create or replace function public.role_code_in(p_role_code text, p_role app_role, allowed text[])
returns boolean
language sql
stable
as $$
  select case
    when public.effective_role_code(p_role_code, p_role) = 'ROOT' then true
    else public.effective_role_code(p_role_code, p_role) = any(allowed)
  end;
$$;

notify pgrst, 'reload schema';
