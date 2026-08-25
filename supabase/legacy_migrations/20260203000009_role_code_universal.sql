-- Universal role_code transition (add + backfill + guardrails)
alter table public.profiles
  add column if not exists role_code text;

alter table public.project_members
  add column if not exists role_code text;

-- Mapping helper
create or replace function public.role_code_from_legacy(p_role app_role)
returns text
language sql
stable
as $$
  select case p_role::text
    when 'OWNER' then 'ADMIN'
    when 'PM' then 'PROJECT_MANAGER'
    when 'USER1' then 'USER_LEVEL_II'
    when 'USER2' then 'USER_LEVEL_I'
    when 'ADMIN' then 'ADMIN'
    when 'TECHNICIAN' then 'USER_LEVEL_I'
    else 'USER_LEVEL_I'
  end;
$$;

-- Backfill role_code for existing rows
update public.profiles
set role_code = public.role_code_from_legacy(role)
where role_code is null;

update public.project_members
set role_code = public.role_code_from_legacy(role)
where role_code is null;

-- Defaults + constraints
alter table public.profiles
  alter column role_code set default 'USER_LEVEL_I';

alter table public.project_members
  alter column role_code set default 'USER_LEVEL_I';

alter table public.profiles
  add constraint profiles_role_code_check
  check (role_code in ('ADMIN','PROJECT_MANAGER','USER_LEVEL_I','USER_LEVEL_II','SUPPORT'));

alter table public.project_members
  add constraint project_members_role_code_check
  check (role_code in ('ADMIN','PROJECT_MANAGER','USER_LEVEL_I','USER_LEVEL_II','SUPPORT'));

-- Keep role_code aligned if legacy role is updated
create or replace function public.set_role_code_from_legacy()
returns trigger
language plpgsql
as $$
begin
  if new.role_code is null then
    new.role_code := public.role_code_from_legacy(new.role);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_role_code on public.profiles;
create trigger trg_profiles_role_code
before insert or update of role, role_code
on public.profiles
for each row
execute function public.set_role_code_from_legacy();

drop trigger if exists trg_project_members_role_code on public.project_members;
create trigger trg_project_members_role_code
before insert or update of role, role_code
on public.project_members
for each row
execute function public.set_role_code_from_legacy();

-- Index for membership lookups
create index if not exists project_members_project_user_idx
  on public.project_members (project_id, user_id);

notify pgrst, 'reload schema';
