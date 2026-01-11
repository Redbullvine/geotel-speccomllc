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
  job_number text,
  location text,
  created_at timestamptz not null default now()
);

alter table public.projects
  add column if not exists customer_name text,
  add column if not exists job_number text,
  add column if not exists active boolean not null default true;

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
  description text,
  status text not null default 'NOT_STARTED',
  started_at timestamptz,
  completed_at timestamptz,
  allowed_units integer not null default 0,
  used_units integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  ready_for_billing boolean not null default false
);

alter table public.nodes
  add column if not exists status text not null default 'NOT_STARTED',
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'nodes_status_check'
      and conrelid = 'public.nodes'::regclass
  ) then
    alter table public.nodes
      add constraint nodes_status_check
      check (status in ('NOT_STARTED','ACTIVE','COMPLETE'));
  end if;
end $$;

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

create or replace function public.fn_enforce_single_active_node()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'ACTIVE' then
    if exists (
      select 1 from public.nodes n
      where n.project_id = new.project_id
        and n.status = 'ACTIVE'
        and n.id <> new.id
    ) then
      raise exception 'Another node is already ACTIVE for this project.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_single_active_node on public.nodes;
create trigger trg_single_active_node
before insert or update on public.nodes
for each row execute function public.fn_enforce_single_active_node();

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

create or replace function public.fn_stamp_splice_taken_at()
returns trigger
language plpgsql
as $$
begin
  if new.photo_path is not null and new.taken_at is null then
    new.taken_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_splice_taken_at on public.splice_locations;
create trigger trg_stamp_splice_taken_at
before insert or update on public.splice_locations
for each row execute function public.fn_stamp_splice_taken_at();

create or replace function public.fn_require_splice_photos()
returns trigger
language plpgsql
as $$
declare
  open_ok boolean;
  closed_ok boolean;
begin
  if new.completed is true then
    select exists (
      select 1 from public.proof_uploads pu
      where pu.splice_location_id = new.id
        and pu.photo_type = 'open'
    ) into open_ok;

    select exists (
      select 1 from public.proof_uploads pu
      where pu.splice_location_id = new.id
        and pu.photo_type = 'closed'
    ) into closed_ok;

    if not open_ok or not closed_ok then
      raise exception 'Splice photos required before completion.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_require_splice_photos on public.splice_locations;
create trigger trg_require_splice_photos
before update on public.splice_locations
for each row execute function public.fn_require_splice_photos();

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

-- 5) Node inventory checklist entries (qty + photo optional)
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
  captured_at_client timestamptz,
  captured_at_server timestamptz not null default now(),
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy_m double precision,
  camera boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.usage_events enable row level security;

alter table public.usage_events
  add column if not exists captured_at_client timestamptz,
  add column if not exists captured_at_server timestamptz not null default now(),
  add column if not exists camera boolean not null default false;

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

create or replace function public.fn_usage_events_server_time()
returns trigger
language plpgsql
as $$
begin
  if new.captured_at_server is null then
    new.captured_at_server := now();
  end if;
  if new.captured_at is null then
    new.captured_at := new.captured_at_server;
  end if;
  return new;
end $$;

drop trigger if exists trg_usage_events_server_time on public.usage_events;
create trigger trg_usage_events_server_time
before insert on public.usage_events
for each row execute function public.fn_usage_events_server_time();

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

-- 7) Orgs + membership (pricing visibility)
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role app_role not null,
  created_at timestamptz not null default now()
);

alter table public.orgs enable row level security;

create policy "orgs_read_all_authed"
on public.orgs for select
to authenticated
using (true);

create policy "orgs_write_owner"
on public.orgs for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'OWNER'
  )
);

create policy "orgs_update_owner"
on public.orgs for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'OWNER'
  )
);

alter table public.profiles
  add column if not exists org_id uuid references public.orgs(id);

-- 8) Unit types + allowed quantities per node
create table if not exists public.unit_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  created_at timestamptz not null default now()
);

alter table public.unit_types enable row level security;

create policy "unit_types_read_all_authed"
on public.unit_types for select
to authenticated
using (true);

create policy "unit_types_write_owner_prime"
on public.unit_types for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('OWNER','PRIME','TDS')
  )
);

create policy "unit_types_update_owner_prime"
on public.unit_types for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('OWNER','PRIME','TDS')
  )
);

create table if not exists public.allowed_quantities (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  unit_type_id uuid not null references public.unit_types(id) on delete cascade,
  allowed_qty integer not null,
  alert_threshold_pct numeric(5,2) default 0.15,
  alert_threshold_abs integer,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'allowed_quantities_unique'
      and conrelid = 'public.allowed_quantities'::regclass
  ) then
    alter table public.allowed_quantities
      add constraint allowed_quantities_unique unique (node_id, unit_type_id);
  end if;
end $$;

alter table public.allowed_quantities enable row level security;

create policy "allowed_quantities_read_all_authed"
on public.allowed_quantities for select
to authenticated
using (true);

create policy "allowed_quantities_write_prime_owner"
on public.allowed_quantities for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('PRIME','OWNER')
  )
);

create policy "allowed_quantities_update_prime_owner"
on public.allowed_quantities for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('PRIME','OWNER')
  )
);

alter table public.usage_events
  add column if not exists unit_type_id uuid references public.unit_types(id),
  add column if not exists proof_required boolean not null default true;

-- 9) Proof uploads
create table if not exists public.proof_uploads (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  usage_event_id uuid references public.usage_events(id) on delete cascade,
  splice_location_id uuid references public.splice_locations(id) on delete cascade,
  photo_url text not null,
  lat double precision,
  lng double precision,
  captured_at timestamptz,
  captured_at_client timestamptz,
  captured_at_server timestamptz not null default now(),
  device_info text,
  camera boolean not null default false,
  job_number text,
  photo_type text,
  captured_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.proof_uploads enable row level security;

alter table public.proof_uploads
  add column if not exists captured_at_client timestamptz,
  add column if not exists captured_at_server timestamptz not null default now(),
  add column if not exists device_info text,
  add column if not exists camera boolean not null default false,
  add column if not exists job_number text,
  add column if not exists photo_type text;

create policy "proof_uploads_read_all_authed"
on public.proof_uploads for select
to authenticated
using (true);

create policy "proof_uploads_write_job_roles"
on public.proof_uploads for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('SPLICER','SUB','PRIME','OWNER')
  )
);

create or replace function public.fn_validate_proof_upload()
returns trigger
language plpgsql
as $$
begin
  if new.camera is not true then
    raise exception 'Camera capture required for photo.';
  end if;
  if new.job_number is null then
    raise exception 'Job number required for photo.';
  end if;
  if new.splice_location_id is not null then
    if new.photo_type is null or new.photo_type not in ('open','closed') then
      raise exception 'Photo type required for splice photos.';
    end if;
  end if;
  if new.lat is null or new.lng is null then
    raise exception 'GPS required for photo.';
  end if;
  if new.captured_at_client is null then
    raise exception 'Client timestamp required for photo.';
  end if;
  if abs(extract(epoch from (now() - new.captured_at_client))) > 300 then
    raise exception 'Photo timestamp too old.';
  end if;
  if new.captured_at_server is null then
    new.captured_at_server := now();
  end if;
  if new.captured_at is null then
    new.captured_at := new.captured_at_server;
  end if;
  return new;
end $$;

drop trigger if exists trg_validate_proof_upload on public.proof_uploads;
create trigger trg_validate_proof_upload
before insert on public.proof_uploads
for each row execute function public.fn_validate_proof_upload();

-- 10) Alerts
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  unit_type_id uuid references public.unit_types(id) on delete cascade,
  allowed_qty integer,
  used_qty integer,
  remaining_qty integer,
  message text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  assigned_to_user_id uuid references public.profiles(id),
  assigned_to_role app_role,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.alerts enable row level security;

create policy "alerts_read_prime_owner"
on public.alerts for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('PRIME','OWNER')
  )
  or assigned_to_user_id = auth.uid()
);

create policy "alerts_update_prime_owner"
on public.alerts for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('PRIME','OWNER')
  )
);

create policy "alerts_insert_prime_owner"
on public.alerts for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('PRIME','OWNER')
  )
);

-- 11) Material catalog
create table if not exists public.material_catalog (
  id uuid primary key default gen_random_uuid(),
  millennium_part text not null,
  mfg_sku text not null,
  description text,
  photo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.material_catalog enable row level security;

create policy "material_catalog_read_all_authed"
on public.material_catalog for select
to authenticated
using (true);

create policy "material_catalog_write_owner_tds"
on public.material_catalog for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('OWNER','TDS')
  )
);

create policy "material_catalog_update_owner_tds"
on public.material_catalog for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('OWNER','TDS')
  )
);

-- 12) Unified invoices + line items (public/private split)
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id),
  node_id uuid references public.nodes(id) on delete cascade,
  billed_by_org_id uuid not null references public.orgs(id),
  billed_to_org_id uuid not null references public.orgs(id),
  status text not null default 'Draft',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.invoices enable row level security;

create policy "invoices_read_by_org"
on public.invoices for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.org_id = billed_by_org_id or p.org_id = billed_to_org_id or p.role = 'OWNER')
  )
);

create policy "invoices_write_by_org"
on public.invoices for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.org_id = billed_by_org_id or p.role in ('OWNER','PRIME'))
  )
);

create policy "invoices_update_by_org"
on public.invoices for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.org_id = billed_by_org_id or p.org_id = billed_to_org_id or p.role = 'OWNER')
  )
);

create table if not exists public.invoice_lines_public (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  unit_type_id uuid references public.unit_types(id),
  qty integer not null,
  created_at timestamptz not null default now()
);

alter table public.invoice_lines_public enable row level security;

create policy "invoice_lines_public_read_by_invoice"
on public.invoice_lines_public for select
to authenticated
using (
  exists (
    select 1
    from public.invoices i
    join public.profiles p on p.id = auth.uid()
    where i.id = invoice_id
      and (p.org_id = i.billed_by_org_id or p.org_id = i.billed_to_org_id or p.role = 'OWNER')
      and p.role in ('TDS','PRIME','SUB','OWNER')
  )
);

create policy "invoice_lines_public_write_by_biller"
on public.invoice_lines_public for insert
to authenticated
with check (
  exists (
    select 1
    from public.invoices i
    join public.profiles p on p.id = auth.uid()
    where i.id = invoice_id
      and (p.org_id = i.billed_by_org_id or p.role = 'OWNER')
      and p.role in ('TDS','PRIME','SUB','OWNER')
  )
);

create table if not exists public.invoice_lines_private (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  unit_price numeric(12,2) not null,
  extended_price numeric(12,2) not null,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

alter table public.invoice_lines_private enable row level security;

create policy "invoice_lines_private_read_by_org"
on public.invoice_lines_private for select
to authenticated
using (
  exists (
    select 1
    from public.invoices i
    join public.profiles p on p.id = auth.uid()
    where i.id = invoice_id
      and (p.org_id = i.billed_by_org_id or p.org_id = i.billed_to_org_id or p.role = 'OWNER')
      and p.role in ('TDS','PRIME','SUB','OWNER')
  )
);

create policy "invoice_lines_private_write_by_biller"
on public.invoice_lines_private for insert
to authenticated
with check (
  exists (
    select 1
    from public.invoices i
    join public.profiles p on p.id = auth.uid()
    where i.id = invoice_id
      and (p.org_id = i.billed_by_org_id or p.role = 'OWNER')
      and p.role in ('TDS','PRIME','SUB','OWNER')
  )
);

-- 13) Alerts trigger (remaining qty threshold)
create or replace function public.fn_alert_on_usage()
returns trigger
language plpgsql
as $$
declare
  allowed integer;
  used integer;
  remaining integer;
  threshold_pct numeric(5,2);
  threshold_abs integer;
  should_alert boolean;
begin
  if new.unit_type_id is null then
    return new;
  end if;

  select aq.allowed_qty, aq.alert_threshold_pct, aq.alert_threshold_abs
  into allowed, threshold_pct, threshold_abs
  from public.allowed_quantities aq
  where aq.node_id = new.node_id and aq.unit_type_id = new.unit_type_id
  limit 1;

  if allowed is null then
    return new;
  end if;

  select coalesce(sum(qty), 0)
  into used
  from public.usage_events ue
  where ue.node_id = new.node_id
    and ue.unit_type_id = new.unit_type_id
    and ue.status = 'approved';

  remaining := allowed - used;
  should_alert := (threshold_abs is not null and remaining <= threshold_abs)
    or (allowed > 0 and remaining::numeric / allowed <= coalesce(threshold_pct, 0.15));

  if should_alert then
    insert into public.alerts (
      node_id, unit_type_id, allowed_qty, used_qty, remaining_qty,
      message, severity, assigned_to_role
    ) values (
      new.node_id,
      new.unit_type_id,
      allowed,
      used,
      remaining,
      'Remaining units below threshold. Request approval for additional units.',
      'warning',
      'PRIME'
    );
  end if;

  return new;
end $$;

drop trigger if exists trg_alert_on_usage on public.usage_events;
create trigger trg_alert_on_usage
after insert on public.usage_events
for each row execute function public.fn_alert_on_usage();

-- 14) Proof gate for invoice submission
create or replace function public.fn_require_proof_for_invoice()
returns trigger
language plpgsql
as $$
declare
  missing_splice boolean;
  missing_usage boolean;
begin
  if new.status not in ('Submitted','Sent','Approved') then
    return new;
  end if;

  if new.node_id is null then
    raise exception 'Invoice requires a node before submission.';
  end if;

  select exists (
    select 1
    from public.splice_locations sl
    left join public.proof_uploads po
      on po.splice_location_id = sl.id and po.photo_type = 'open'
    left join public.proof_uploads pc
      on pc.splice_location_id = sl.id and pc.photo_type = 'closed'
    where sl.node_id = new.node_id
      and (po.id is null or pc.id is null)
  ) into missing_splice;

  select exists (
    select 1 from public.usage_events ue
    where ue.node_id = new.node_id
      and coalesce(ue.proof_required, true) = true
      and (ue.photo_path is null or ue.gps_lat is null or ue.captured_at_server is null)
  ) into missing_usage;

  if missing_splice or missing_usage then
    raise exception 'Photos required before invoice submission.';
  end if;

  return new;
end $$;

drop trigger if exists trg_require_proof_for_invoice on public.invoices;
create trigger trg_require_proof_for_invoice
before insert or update on public.invoices
for each row execute function public.fn_require_proof_for_invoice();

drop trigger if exists trg_require_proof_for_sub_invoice on public.sub_invoices;
create trigger trg_require_proof_for_sub_invoice
before insert or update on public.sub_invoices
for each row execute function public.fn_require_proof_for_invoice();

drop trigger if exists trg_require_proof_for_prime_invoice on public.prime_invoices;
create trigger trg_require_proof_for_prime_invoice
before insert or update on public.prime_invoices
for each row execute function public.fn_require_proof_for_invoice();

-- Helper: billing readiness view (after usage_events columns are present)
create or replace view public.node_billing_ready as
select
  n.id,
  n.node_number,
  n.allowed_units,
  n.used_units,
  n.ready_for_billing,
  (select bool_and(sl.completed) from public.splice_locations sl where sl.node_id = n.id) as all_splice_locations_complete,
  (select bool_and(
     exists (select 1 from public.proof_uploads po where po.splice_location_id = sl.id and po.photo_type = 'open')
     and exists (select 1 from public.proof_uploads pc where pc.splice_location_id = sl.id and pc.photo_type = 'closed')
   ) from public.splice_locations sl where sl.node_id = n.id) as all_splice_photos_complete,
  (select bool_and(ni.completed) from public.node_inventory ni where ni.node_id = n.id) as all_inventory_complete,
  (select bool_and(
     coalesce(ue.proof_required, true) = false
     or (ue.photo_path is not null and ue.gps_lat is not null and ue.captured_at_server is not null)
   ) from public.usage_events ue where ue.node_id = n.id) as all_usage_proof_complete
from public.nodes n;
