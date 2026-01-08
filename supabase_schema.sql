-- SpecCom Starter Schema (MVP)
-- Paste into Supabase SQL editor.
-- Assumes auth is enabled.

-- 0) Roles
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type app_role as enum ('TDS','PRIME','SUB','SPLICER','OWNER');
  end if;
end $$;

-- 1) Profiles (one row per auth user)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role app_role not null default 'SPLICER',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users can read their own profile
create policy "profiles_read_own"
on public.profiles for select
to authenticated
using (auth.uid() = id);

-- OWNER can read all profiles
create policy "profiles_owner_read_all"
on public.profiles for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'OWNER'
  )
);

-- OWNER can update roles (simple)
create policy "profiles_owner_update"
on public.profiles for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'OWNER'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'OWNER'
  )
);

-- 1b) Projects
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  location text,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

create policy "projects_read_all_authed"
on public.projects for select
to authenticated
using (true);

create policy "projects_write_owner_prime_tds"
on public.projects for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('OWNER','PRIME','TDS')
  )
);

create policy "projects_update_owner_prime_tds"
on public.projects for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('OWNER','PRIME','TDS')
  )
);

-- 2) Nodes
create table if not exists public.nodes (
  id uuid primary key default gen_random_uuid(),
  node_number text unique not null,
  project_id uuid references public.projects(id),
  allowed_units integer not null default 0,
  used_units integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  ready_for_billing boolean not null default false
);

alter table public.nodes enable row level security;

-- Everyone on the job can see nodes (no pricing here)
create policy "nodes_read_all_authed"
on public.nodes for select
to authenticated
using (true);

-- PRIME/SUB/OWNER can create nodes
create policy "nodes_write_prime_sub_owner"
on public.nodes for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('PRIME','SUB','OWNER','TDS')
  )
);

create policy "nodes_update_prime_sub_owner"
on public.nodes for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('PRIME','SUB','OWNER','TDS')
  )
);

-- 3) Splice locations (documentation gate)
create table if not exists public.splice_locations (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  location_label text not null,
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy_m double precision,
  photo_path text, -- Supabase Storage path
  taken_at timestamptz,
  completed boolean not null default false,
  completed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.splice_locations enable row level security;

create policy "splice_locations_read_all_authed"
on public.splice_locations for select
to authenticated
using (true);

-- SPLICER/SUB/PRIME/OWNER can insert/update splice evidence
create policy "splice_locations_write_job_roles"
on public.splice_locations for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('SPLICER','SUB','PRIME','OWNER')
  )
);

create policy "splice_locations_update_job_roles"
on public.splice_locations for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('SPLICER','SUB','PRIME','OWNER')
  )
);

-- 4) Inventory master (NO pricing fields here)
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  vendor_code text unique not null,
  display_name text not null,
  manufacturer text,
  photo_path text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.inventory_items enable row level security;

create policy "inventory_items_read_all_authed"
on public.inventory_items for select
to authenticated
using (true);

-- Only OWNER/TDS can manage item master
create policy "inventory_items_write_owner_tds"
on public.inventory_items for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('OWNER','TDS')
  )
);

create policy "inventory_items_update_owner_tds"
on public.inventory_items for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('OWNER','TDS')
  )
);

-- 5) Node inventory checklist entries (qty + proof optional)
create table if not exists public.node_inventory (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  qty_used integer not null default 0,
  planned_qty integer not null default 0,
  completed boolean not null default false,
  completed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.node_inventory enable row level security;

create policy "node_inventory_read_all_authed"
on public.node_inventory for select
to authenticated
using (true);

create policy "node_inventory_write_job_roles"
on public.node_inventory for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('SPLICER','SUB','PRIME','OWNER')
  )
);

create policy "node_inventory_update_job_roles"
on public.node_inventory for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('SPLICER','SUB','PRIME','OWNER')
  )
);

-- 5b) Usage events (approval-aware)
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  qty integer not null,
  status text not null default 'approved',
  photo_path text,
  captured_at timestamptz,
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy_m double precision,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.usage_events enable row level security;

create policy "usage_events_read_all_authed"
on public.usage_events for select
to authenticated
using (true);

create policy "usage_events_write_job_roles"
on public.usage_events for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('SPLICER','SUB','PRIME','OWNER')
  )
);

-- 6) Pricing tables (kept separate, heavily locked)
-- TDS price sheet: only TDS + OWNER can read/manage
create table if not exists public.tds_price_sheet (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  unit_price numeric(12,2) not null,
  currency text not null default 'USD',
  effective_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.tds_price_sheet enable row level security;

create policy "tds_prices_read_tds_owner"
on public.tds_price_sheet for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('TDS','OWNER')
  )
);

create policy "tds_prices_write_tds_owner"
on public.tds_price_sheet for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('TDS','OWNER')
  )
);

create policy "tds_prices_update_tds_owner"
on public.tds_price_sheet for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('TDS','OWNER')
  )
);

-- SUB invoices: visible to SUB + PRIME + OWNER ONLY
create table if not exists public.sub_invoices (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  invoice_number text,
  status text not null default 'Draft',
  total numeric(12,2),
  currency text not null default 'USD',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.sub_invoices enable row level security;

create policy "sub_invoices_read_sub_prime_owner"
on public.sub_invoices for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('SUB','PRIME','OWNER')
  )
);

create policy "sub_invoices_write_sub_owner"
on public.sub_invoices for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('SUB','OWNER')
  )
);

create policy "sub_invoices_update_sub_prime_owner"
on public.sub_invoices for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('SUB','PRIME','OWNER')
  )
);

-- PRIME-to-TDS invoices: visible to PRIME + TDS + OWNER ONLY
create table if not exists public.prime_invoices (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  invoice_number text,
  status text not null default 'Draft',
  total numeric(12,2),
  currency text not null default 'USD',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.prime_invoices enable row level security;

create policy "prime_invoices_read_prime_tds_owner"
on public.prime_invoices for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('PRIME','TDS','OWNER')
  )
);

create policy "prime_invoices_write_prime_owner"
on public.prime_invoices for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('PRIME','OWNER')
  )
);

create policy "prime_invoices_update_prime_tds_owner"
on public.prime_invoices for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('PRIME','TDS','OWNER')
  )
);

-- Helper: billing readiness view
create or replace view public.node_billing_ready as
select
  n.id,
  n.node_number,
  n.allowed_units,
  n.used_units,
  n.ready_for_billing,
  (select bool_and(sl.completed) from public.splice_locations sl where sl.node_id = n.id) as all_splice_locations_complete,
  (select bool_and(ni.completed) from public.node_inventory ni where ni.node_id = n.id) as all_inventory_complete
from public.nodes n;
