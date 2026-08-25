-- Add missing project demo flag + site import columns
alter table public.projects
  add column if not exists is_demo boolean not null default false;

alter table public.sites
  add column if not exists drop_number text,
  add column if not exists work_type text,
  add column if not exists billing_code_default text;

notify pgrst, 'reload schema';
