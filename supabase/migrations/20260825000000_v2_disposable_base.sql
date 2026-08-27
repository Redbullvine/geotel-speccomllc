-- Disposable local V2 lab only. This supplies the canonical projects table
-- required by the additive V2 foundation without importing any V1 schema/data.
create extension if not exists pgcrypto;
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;
