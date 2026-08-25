alter table public.projects
  add column if not exists created_by uuid references auth.users(id);

create index if not exists projects_created_by_idx on public.projects(created_by);
