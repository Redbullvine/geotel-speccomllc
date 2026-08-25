-- Ensure profile columns used by the app exist
alter table public.profiles
  add column if not exists preferred_language text not null default 'en',
  add column if not exists is_demo boolean not null default false;
