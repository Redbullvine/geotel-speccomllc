-- SpecCom V2 clean-host prerequisite.
-- This migration exists for brand-new isolated V2 databases that do not have
-- the legacy SpecCom schema. It intentionally creates only the canonical
-- projects table required by the additive V2 foundation.
--
-- NO legacy profiles, roles, memberships, account hierarchy, or permissive
-- project policies are created here.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

-- A fresh V2 worker must never enumerate projects directly from the browser.
-- Gateway/owner setup operations are server-side only. The V2 foundation adds
-- the project-scoped authorization model used by project-owned tables.
revoke all on public.projects from anon, authenticated;
