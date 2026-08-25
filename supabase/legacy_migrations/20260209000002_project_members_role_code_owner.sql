-- Allow OWNER in project_members.role_code
alter table public.project_members
  drop constraint if exists project_members_role_code_check;

alter table public.project_members
  add constraint project_members_role_code_check
  check (role_code in (
    'ROOT',
    'OWNER',
    'ADMIN',
    'PROJECT_MANAGER',
    'USER_LEVEL_1',
    'USER_LEVEL_2',
    'SUPPORT'
  ));
