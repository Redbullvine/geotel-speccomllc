-- Ensure preferred_language exists and is populated
alter table public.profiles
  add column if not exists preferred_language text;

alter table public.profiles
  alter column preferred_language set default 'en';

update public.profiles
set preferred_language = coalesce(preferred_language, 'en')
where preferred_language is null;

-- Optional columns used by the app
alter table public.profiles
  add column if not exists is_demo boolean not null default false,
  add column if not exists current_project_id uuid;

notify pgrst, 'reload schema';
