-- Restore role column to profiles table.
-- The 20260315000001_reset_roles_open_access.sql migration dropped this column.
-- This migration adds it back with ROOT included as a valid value.

alter table public.profiles
  add column if not exists role text not null default 'SPLICER';

alter table public.profiles
  drop constraint if exists profiles_role_valid;

alter table public.profiles
  add constraint profiles_role_valid
  check (role in ('ROOT','OWNER','ADMIN','PRIME','TDS','SUB','SPLICER','TECHNICIAN'));

notify pgrst, 'reload schema';
