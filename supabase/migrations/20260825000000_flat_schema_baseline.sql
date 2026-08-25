-- SpecCom flat schema baseline
-- Target project: sgrxziinfvwswjlrhzqu
--
-- Access model (deliberately flat):
--   * Every table has RLS enabled.
--   * The `authenticated` role has full read/write on every table.
--   * `anon` has no policies at all, so RLS denies it everything.
--   * No roles, no permission flags, no orgs/tenants anywhere.
--
-- Every table carries `project text not null default 'ruidoso'` from day one,
-- so multi-project scoping never needs a backfill migration later.

create extension if not exists pgcrypto;

-- ---------- enum types ----------
-- These are plain domain vocabularies (work order kind / status / time event),
-- not access-control roles.
do $$ begin
  create type public.work_order_type as enum ('INSTALL','TROUBLE_TICKET','MAINTENANCE','SURVEY');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.work_order_status as enum (
    'NEW','ASSIGNED','EN_ROUTE','ON_SITE','IN_PROGRESS','BLOCKED','COMPLETE','CANCELED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.technician_time_event_type as enum (
    'START_JOB','PAUSE_JOB','END_JOB','LUNCH','BREAK_15','TRUCK_INSPECTION');
exception when duplicate_object then null; end $$;


-- ---------- projects ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  job_number text,
  location text,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  customer_name text,
  active boolean not null default true,
  is_demo boolean not null default false,
  project text not null default 'ruidoso'
);
create index if not exists projects_project_idx on public.projects (project);

-- ---------- alert_events ----------
create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  item_key text not null,
  alert_type text not null,
  expected_qty integer,
  actual_qty integer,
  on_hand integer,
  message text not null,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  is_open boolean not null default true,
  project text not null default 'ruidoso'
);
create index if not exists alert_events_project_idx on public.alert_events (project);

-- ---------- alert_subscriptions ----------
create table if not exists public.alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text not null,
  sms_enabled boolean not null default false,
  cooldown_minutes integer not null default 30,
  project text not null default 'ruidoso'
);
create index if not exists alert_subscriptions_project_idx on public.alert_subscriptions (project);

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  work_email text,
  employee_id text,
  created_at timestamptz not null default now(),
  current_project_id uuid,
  preferred_language text not null default 'en',
  is_demo boolean not null default false,
  avatar_url text,
  project text not null default 'ruidoso'
);
create index if not exists profiles_project_idx on public.profiles (project);

-- ---------- nodes ----------
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
  ready_for_billing boolean not null default false,
  project text not null default 'ruidoso'
);
create index if not exists nodes_project_idx on public.nodes (project);

-- ---------- unit_types ----------
create table if not exists public.unit_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists unit_types_project_idx on public.unit_types (project);

-- ---------- alerts ----------
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
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  project text not null default 'ruidoso'
);
create index if not exists alerts_project_idx on public.alerts (project);

-- ---------- allowed_quantities ----------
create table if not exists public.allowed_quantities (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  unit_type_id uuid not null references public.unit_types(id) on delete cascade,
  allowed_qty integer not null,
  alert_threshold_pct numeric(5,2) default 0.15,
  alert_threshold_abs integer,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists allowed_quantities_project_idx on public.allowed_quantities (project);

-- ---------- app_config ----------
create table if not exists public.app_config (
  key text primary key,
  enabled boolean not null default false,
  project text not null default 'ruidoso'
);
create index if not exists app_config_project_idx on public.app_config (project);

-- ---------- daily_progress_reports ----------
create table if not exists public.daily_progress_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null,
  created_by uuid not null references auth.users(id),
  metrics jsonb not null default '{}'::jsonb,
  comments text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz not null default now(),
  summary text,
  project text not null default 'ruidoso'
);
create index if not exists daily_progress_reports_project_idx on public.daily_progress_reports (project);

-- ---------- field_day_sessions ----------
create table if not exists public.field_day_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_date date not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  total_minutes integer not null default 0,
  start_gps_lat double precision null,
  start_gps_lng double precision null,
  start_gps_accuracy_m double precision null,
  end_gps_lat double precision null,
  end_gps_lng double precision null,
  end_gps_accuracy_m double precision null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists field_day_sessions_project_idx on public.field_day_sessions (project);

-- ---------- field_day_acceptances ----------
create table if not exists public.field_day_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id uuid references public.field_day_sessions(id) on delete cascade,
  work_date date not null,
  accepted_at timestamptz not null default now(),
  device_user_agent text,
  notice_version text not null default 'recorded_project_day_v1',
  notice_text text,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists field_day_acceptances_project_idx on public.field_day_acceptances (project);

-- ---------- sites ----------
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  notes text null,
  gps_lat double precision null,
  gps_lng double precision null,
  gps_accuracy_m double precision null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  drop_number text,
  work_type text,
  billing_code_default text,
  project text not null default 'ruidoso'
);
create index if not exists sites_project_idx on public.sites (project);

-- ---------- field_day_events ----------
create table if not exists public.field_day_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.field_day_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  site_id uuid null references public.sites(id) on delete set null,
  event_type text not null,
  label text null,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  duration_minutes integer not null default 0,
  gps_lat double precision null,
  gps_lng double precision null,
  gps_accuracy_m double precision null,
  site_lat double precision null,
  site_lng double precision null,
  notes text null,
  work_codes text[] not null default '{}'::text[],
  materials_used jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists field_day_events_project_idx on public.field_day_events (project);

-- ---------- field_location_pings ----------
create table if not exists public.field_location_pings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete set null,
  site_id uuid null references public.sites(id) on delete set null,
  work_date date not null,
  captured_at timestamptz not null default now(),
  gps_lat double precision not null,
  gps_lng double precision not null,
  gps_accuracy_m double precision null,
  nearest_distance_m double precision null,
  source text not null default 'truck_gps',
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists field_location_pings_project_idx on public.field_location_pings (project);

-- ---------- field_photos ----------
create table if not exists public.field_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid null references public.projects(id) on delete set null,
  file_name text not null,
  mh_number text,
  image_url text not null,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists field_photos_project_idx on public.field_photos (project);

-- ---------- field_time_adjustments ----------
create table if not exists public.field_time_adjustments (
  id uuid primary key default gen_random_uuid(),
  project_day_id uuid references public.field_day_sessions(id) on delete cascade,
  field_day_event_id uuid references public.field_day_events(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  original_value jsonb not null,
  corrected_value jsonb not null,
  reason text not null,
  admin_user_id uuid not null,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists field_time_adjustments_project_idx on public.field_time_adjustments (project);

-- ---------- field_work_logs ----------
create table if not exists public.field_work_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  site_id uuid null references public.sites(id) on delete set null,
  work_date date not null,
  arrived_at timestamptz null,
  completed_at timestamptz not null default now(),
  gps_lat double precision null,
  gps_lng double precision null,
  gps_accuracy_m double precision null,
  nearest_distance_m double precision null,
  status_before text null,
  status_after text null,
  work_completed text null,
  work_codes text[] not null default '{}'::text[],
  materials_used jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists field_work_logs_project_idx on public.field_work_logs (project);

-- ---------- inventory_items ----------
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  vendor_code text,
  display_name text,
  manufacturer text,
  photo_path text,
  active boolean,
  created_at timestamptz not null default now(),
  company_id uuid,
  item_key text,
  name text,
  unit text,
  reorder_point integer,
  is_active boolean,
  project text not null default 'ruidoso'
);
create index if not exists inventory_items_project_idx on public.inventory_items (project);

-- ---------- inventory_stock ----------
create table if not exists public.inventory_stock (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  on_hand integer not null default 0,
  updated_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists inventory_stock_project_idx on public.inventory_stock (project);

-- ---------- invoice_files ----------
create table if not exists public.invoice_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid null references public.projects(id) on delete set null,
  file_name text not null,
  file_path text not null,
  uploaded_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists invoice_files_project_idx on public.invoice_files (project);

-- ---------- splice_locations ----------
create table if not exists public.splice_locations (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  location_label text not null,
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy_m double precision,
  photo_path text,
  taken_at timestamptz,
  completed boolean not null default false,
  completed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  label text,
  sort_order int,
  work_codes text[] not null default '{}'::text[],
  work_description text not null default '',
  project text not null default 'ruidoso'
);
create index if not exists splice_locations_project_idx on public.splice_locations (project);

-- ---------- invoices ----------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id),
  node_id uuid references public.nodes(id) on delete cascade,
  status text not null default 'Draft',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  location_id uuid references public.splice_locations(id),
  invoice_number text,
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text,
  updated_at timestamptz not null default now(),
  site_id uuid references public.sites(id),
  project text not null default 'ruidoso'
);
create index if not exists invoices_project_idx on public.invoices (project);

-- ---------- work_codes ----------
create table if not exists public.work_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  description text,
  unit text,
  default_rate numeric(10,2),
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists work_codes_project_idx on public.work_codes (project);

-- ---------- invoice_items ----------
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  work_code_id uuid references public.work_codes(id),
  description text,
  unit text,
  qty numeric(12,2) not null default 0,
  rate numeric(10,2) not null default 0,
  amount numeric(12,2) generated always as (qty * rate) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists invoice_items_project_idx on public.invoice_items (project);

-- ---------- invoice_lines_private ----------
create table if not exists public.invoice_lines_private (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  unit_price numeric(12,2) not null,
  extended_price numeric(12,2) not null,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists invoice_lines_private_project_idx on public.invoice_lines_private (project);

-- ---------- invoice_lines_public ----------
create table if not exists public.invoice_lines_public (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  unit_type_id uuid references public.unit_types(id),
  qty integer not null,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists invoice_lines_public_project_idx on public.invoice_lines_public (project);

-- ---------- ks_invoice_import_batches ----------
create table if not exists public.ks_invoice_import_batches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid null references public.projects(id) on delete set null,
  uploaded_zip_name text not null,
  total_files integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists ks_invoice_import_batches_project_idx on public.ks_invoice_import_batches (project);

-- ---------- ks_invoice_records ----------
create table if not exists public.ks_invoice_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid null references public.projects(id) on delete set null,
  invoice_number text not null,
  invoice_number_norm text not null,
  customer_name text not null default 'K & S Electric',
  source_filename text not null default '',
  source_file_path text not null default '',
  source_mime text not null default 'application/pdf',
  import_batch_id uuid null references public.ks_invoice_import_batches(id) on delete set null,
  imported_at timestamptz not null default now(),
  status text not null default 'imported',
  notes text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  extracted_data jsonb not null default '{}'::jsonb,
  created_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  invoice_key text not null default '',
  invoice_date text not null default '',
  week_ending text not null default '',
  project_name text not null default '',
  node_name text not null default '',
  bill_to_company text not null default '',
  line_items jsonb not null default '[]'::jsonb,
  grand_total numeric(12,2),
  parse_status text not null default 'parsed',
  parse_error text not null default '',
  project text not null default 'ruidoso'
);
create index if not exists ks_invoice_records_project_idx on public.ks_invoice_records (project);

-- ---------- location_proof_requirements ----------
create table if not exists public.location_proof_requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id),
  location_type text,
  required_photos integer not null default 0,
  enforce_geofence boolean not null default false,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists location_proof_requirements_project_idx on public.location_proof_requirements (project);

-- ---------- material_catalog ----------
create table if not exists public.material_catalog (
  id uuid primary key default gen_random_uuid(),
  millennium_part text not null,
  mfg_sku text not null,
  description text,
  photo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists material_catalog_project_idx on public.material_catalog (project);

-- ---------- material_requirements ----------
create table if not exists public.material_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  feature_id text not null,
  item_key text not null,
  qty_required integer not null default 1,
  raw_label text,
  source text not null default 'kmz',
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists material_requirements_project_idx on public.material_requirements (project);

-- ---------- material_usage ----------
create table if not exists public.material_usage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  feature_id text not null,
  item_key text not null,
  qty_used integer not null default 1,
  used_by uuid not null references auth.users(id),
  used_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists material_usage_project_idx on public.material_usage (project);

-- ---------- messages ----------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  sender_id uuid references auth.users(id),
  message_text text not null,
  created_at timestamptz not null default now(),
  recipient_id uuid null references auth.users(id),
  body text,
  priority int not null default 0,
  is_read boolean not null default false,
  user_id uuid references auth.users(id),
  user_name text,
  scope text not null default 'company',
  pinned boolean not null default false,
  channel text not null default 'DM',
  sender_deleted_at timestamptz null,
  recipient_deleted_at timestamptz null,
  project text not null default 'ruidoso'
);
create index if not exists messages_project_idx on public.messages (project);

-- ---------- node_inventory ----------
create table if not exists public.node_inventory (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  qty_used integer not null default 0,
  planned_qty integer not null default 0,
  completed boolean not null default false,
  completed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists node_inventory_project_idx on public.node_inventory (project);

-- ---------- owner_overrides ----------
create table if not exists public.owner_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  splice_location_id uuid references public.splice_locations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  override_type text not null check (override_type in ('BACKFILL_ALLOWED','BILLING_UNLOCKED')),
  reason text not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists owner_overrides_project_idx on public.owner_overrides (project);

-- ---------- pricing_agreements ----------
create table if not exists public.pricing_agreements (
  id uuid primary key default gen_random_uuid(),
  from_company_id uuid not null,
  to_company_id uuid not null,
  billing_code text not null,
  unit_price numeric(10,2) not null,
  currency text not null default 'USD',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists pricing_agreements_project_idx on public.pricing_agreements (project);

-- ---------- prime_invoices ----------
create table if not exists public.prime_invoices (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  invoice_number text,
  status text not null default 'Draft',
  total numeric(12,2),
  currency text not null default 'USD',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists prime_invoices_project_idx on public.prime_invoices (project);

-- ---------- project_kmz_snapshots ----------
create table if not exists public.project_kmz_snapshots (
  project_id uuid primary key references public.projects(id) on delete cascade,
  kmz_rows jsonb not null default '[]'::jsonb,
  kmz_layer_names text[] not null default '{}'::text[],
  kmz_folder_tree jsonb null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists project_kmz_snapshots_project_idx on public.project_kmz_snapshots (project);

-- ---------- usage_events ----------
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
  created_at timestamptz not null default now(),
  unit_type_id uuid references public.unit_types(id),
  proof_required boolean not null default true,
  project text not null default 'ruidoso'
);
create index if not exists usage_events_project_idx on public.usage_events (project);

-- ---------- proof_uploads ----------
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
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists proof_uploads_project_idx on public.proof_uploads (project);

-- ---------- rate_cards ----------
create table if not exists public.rate_cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  project_id uuid references public.projects(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists rate_cards_project_idx on public.rate_cards (project);

-- ---------- rate_card_items ----------
create table if not exists public.rate_card_items (
  id uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null references public.rate_cards(id) on delete cascade,
  work_code_id uuid not null references public.work_codes(id) on delete cascade,
  rate numeric(10,2) not null,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists rate_card_items_project_idx on public.rate_card_items (project);

-- ---------- redline_markers ----------
create table if not exists public.redline_markers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  site_id uuid null,
  project_id uuid null,
  location_id uuid null,
  sheet_ref text null,
  source_type text not null default 'sheet',
  source_page integer null,
  marker_x numeric not null,
  marker_y numeric not null,
  change_type text not null,
  title text null,
  old_value text null,
  new_value text null,
  notes text null,
  status text not null default 'open',
  photo_url text null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attached_node_id text,
  node_name text,
  project text not null default 'ruidoso'
);
create index if not exists redline_markers_project_idx on public.redline_markers (project);

-- ---------- site_billing_codes ----------
create table if not exists public.site_billing_codes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  billing_code text not null,
  quantity numeric not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists site_billing_codes_project_idx on public.site_billing_codes (project);

-- ---------- site_codes ----------
create table if not exists public.site_codes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  code text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists site_codes_project_idx on public.site_codes (project);

-- ---------- site_entries ----------
create table if not exists public.site_entries (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  description text not null,
  quantity numeric null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists site_entries_project_idx on public.site_entries (project);

-- ---------- site_media ----------
create table if not exists public.site_media (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  media_path text not null,
  gps_lat double precision null,
  gps_lng double precision null,
  gps_accuracy_m double precision null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  source text not null default 'reference_upload',
  proof_type text,
  is_live_proof boolean not null default false,
  backfilled boolean not null default false,
  device_user_agent text,
  captured_at_locked boolean not null default true,
  gps_locked boolean not null default true,
  project text not null default 'ruidoso'
);
create index if not exists site_media_project_idx on public.site_media (project);

-- ---------- site_verification_photos ----------
create table if not exists public.site_verification_photos (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid references public.profiles(id),
  photo_path text not null,
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy_m double precision,
  captured_at timestamptz,
  uploaded_at timestamptz not null default now(),
  metadata jsonb,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists site_verification_photos_project_idx on public.site_verification_photos (project);

-- ---------- splice_location_photos ----------
create table if not exists public.splice_location_photos (
  id uuid primary key default gen_random_uuid(),
  splice_location_id uuid not null references public.splice_locations(id) on delete cascade,
  slot_key text not null,
  photo_path text not null,
  taken_at timestamptz,
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy_m double precision,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  source text default 'camera',
  backfilled boolean not null default false,
  exif_taken_at timestamptz,
  proof_type text,
  device_user_agent text,
  created_at_server timestamptz not null default now(),
  captured_at_locked boolean not null default true,
  gps_locked boolean not null default true,
  project text not null default 'ruidoso'
);
create index if not exists splice_location_photos_project_idx on public.splice_location_photos (project);

-- ---------- splicer_location_closeout_checklists ----------
create table if not exists public.splicer_location_closeout_checklists (
  id uuid primary key default gen_random_uuid(),
  project_day_id uuid references public.field_day_sessions(id) on delete cascade,
  location_visit_id uuid references public.field_day_events(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  base_location_id uuid references public.sites(id) on delete set null,
  visit_label text,
  submitted_at timestamptz not null default now(),
  gps_lat numeric,
  gps_lng numeric,
  gps_accuracy_m numeric,
  checklist jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists splicer_location_closeout_checklists_project_idx on public.splicer_location_closeout_checklists (project);

-- ---------- sub_invoices ----------
create table if not exists public.sub_invoices (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  invoice_number text,
  status text not null default 'Draft',
  total numeric(12,2),
  currency text not null default 'USD',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists sub_invoices_project_idx on public.sub_invoices (project);

-- ---------- subcontractor_agreements ----------
create table if not exists public.subcontractor_agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  agreement_type text not null,
  agreement_version text not null default '2026-06',
  signer_name text not null,
  signature_data text not null,
  accepted_terms boolean default false,
  signed_at timestamptz default now(),
  ip_address text,
  user_agent text,
  project text not null default 'ruidoso'
);
create index if not exists subcontractor_agreements_project_idx on public.subcontractor_agreements (project);

-- ---------- subcontractor_documents ----------
create table if not exists public.subcontractor_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  document_type text not null,
  file_path text not null,
  file_name text,
  mime_type text,
  status text default 'uploaded',
  rejection_reason text,
  expires_at date,
  uploaded_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  project text not null default 'ruidoso'
);
create index if not exists subcontractor_documents_project_idx on public.subcontractor_documents (project);

-- ---------- subcontractor_profiles ----------
create table if not exists public.subcontractor_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) unique not null,
  full_name text,
  company_name text,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  emergency_contact_name text,
  emergency_contact_phone text,
  onboarding_status text default 'draft',
  admin_notes text,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  project text not null default 'ruidoso'
);
create index if not exists subcontractor_profiles_project_idx on public.subcontractor_profiles (project);

-- ---------- tds_price_sheet ----------
create table if not exists public.tds_price_sheet (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  unit_price numeric(12,2) not null,
  currency text not null default 'USD',
  effective_date date not null default current_date,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists tds_price_sheet_project_idx on public.tds_price_sheet (project);

-- ---------- technician_timesheets ----------
create table if not exists public.technician_timesheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_date date not null default current_date,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  total_minutes_worked integer,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists technician_timesheets_project_idx on public.technician_timesheets (project);

-- ---------- work_orders ----------
create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  external_source text null,
  external_id text null,
  type public.work_order_type not null,
  status public.work_order_status not null default 'NEW',
  scheduled_start timestamptz null,
  scheduled_end timestamptz null,
  address text null,
  lat double precision null,
  lng double precision null,
  customer_label text null,
  contact_phone text null,
  notes text null,
  priority int not null default 3,
  sla_due_at timestamptz null,
  assigned_to_user_id uuid null references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists work_orders_project_idx on public.work_orders (project);

-- ---------- technician_time_events ----------
create table if not exists public.technician_time_events (
  id uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null references public.technician_timesheets(id) on delete cascade,
  event_type public.technician_time_event_type not null,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes integer,
  created_at timestamptz not null default now(),
  work_order_id uuid references public.work_orders(id),
  project text not null default 'ruidoso'
);
create index if not exists technician_time_events_project_idx on public.technician_time_events (project);

-- ---------- text_translations ----------
create table if not exists public.text_translations (
  id bigserial primary key,
  source_lang text not null check (source_lang in ('en','es','auto')),
  target_lang text not null check (target_lang in ('en','es')),
  source_hash text not null,
  source_text text not null,
  translated_text text not null,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists text_translations_project_idx on public.text_translations (project);

-- ---------- user_locations ----------
create table if not exists public.user_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  heading double precision null,
  speed double precision null,
  accuracy double precision null,
  updated_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists user_locations_project_idx on public.user_locations (project);

-- ---------- work_order_events ----------
create table if not exists public.work_order_events (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  project text not null default 'ruidoso'
);
create index if not exists work_order_events_project_idx on public.work_order_events (project);


-- ---------- uniqueness the app relies on for upserts ----------
create unique index if not exists profiles_work_email_unique
  on public.profiles (lower(work_email)) where work_email is not null;
create unique index if not exists profiles_employee_id_unique
  on public.profiles (employee_id) where employee_id is not null;
create unique index if not exists pricing_agreements_unique
  on public.pricing_agreements (from_company_id, to_company_id, billing_code);
create unique index if not exists inventory_items_company_item_key_idx
  on public.inventory_items (company_id, item_key);
create unique index if not exists inventory_items_company_vendor_code_idx
  on public.inventory_items (company_id, vendor_code) where nullif(vendor_code, '') is not null;
create unique index if not exists text_translations_unique
  on public.text_translations (target_lang, source_hash);
create unique index if not exists allowed_quantities_unique
  on public.allowed_quantities (node_id, unit_type_id);
create unique index if not exists rate_card_items_unique
  on public.rate_card_items (rate_card_id, work_code_id);
-- org_id is gone in the flat schema; these rows are scoped by `project` instead
create unique index if not exists ks_invoice_records_project_invoice_norm_idx
  on public.ks_invoice_records (project, invoice_number_norm);
create unique index if not exists splice_location_photos_slot_idx
  on public.splice_location_photos (splice_location_id, slot_key);
create unique index if not exists work_orders_external_idx
  on public.work_orders (project_id, external_source, external_id);
create unique index if not exists project_kmz_snapshots_project_idx
  on public.project_kmz_snapshots (project_id);
create unique index if not exists user_locations_user_idx
  on public.user_locations (user_id);
create unique index if not exists subcontractor_profiles_user_idx
  on public.subcontractor_profiles (user_id);

-- ---------- location_proof_status ----------
-- Read-only rollup the field app selects from:
--   location_id, proof_required, proof_uploaded
-- security_invoker keeps the caller's RLS in force, so anon stays blocked.
create or replace view public.location_proof_status
with (security_invoker = true) as
  select
    sl.id                            as location_id,
    coalesce(req.required_photos, 0) as proof_required,
    coalesce(ph.uploaded, 0)         as proof_uploaded,
    sl.project                       as project
  from public.splice_locations sl
  join public.nodes n on n.id = sl.node_id
  left join lateral (
    select max(r.required_photos) as required_photos
    from public.location_proof_requirements r
    where r.project_id = n.project_id
  ) req on true
  left join lateral (
    select count(*) as uploaded
    from public.splice_location_photos p
    where p.splice_location_id = sl.id
  ) ph on true;


-- ---------- row level security ----------
-- authenticated: full access.  anon: no policy => no access.
alter table public.projects enable row level security;
drop policy if exists "projects_authenticated_all" on public.projects;
create policy "projects_authenticated_all" on public.projects
  for all to authenticated using (true) with check (true);

alter table public.alert_events enable row level security;
drop policy if exists "alert_events_authenticated_all" on public.alert_events;
create policy "alert_events_authenticated_all" on public.alert_events
  for all to authenticated using (true) with check (true);

alter table public.alert_subscriptions enable row level security;
drop policy if exists "alert_subscriptions_authenticated_all" on public.alert_subscriptions;
create policy "alert_subscriptions_authenticated_all" on public.alert_subscriptions
  for all to authenticated using (true) with check (true);

alter table public.profiles enable row level security;
drop policy if exists "profiles_authenticated_all" on public.profiles;
create policy "profiles_authenticated_all" on public.profiles
  for all to authenticated using (true) with check (true);

alter table public.nodes enable row level security;
drop policy if exists "nodes_authenticated_all" on public.nodes;
create policy "nodes_authenticated_all" on public.nodes
  for all to authenticated using (true) with check (true);

alter table public.unit_types enable row level security;
drop policy if exists "unit_types_authenticated_all" on public.unit_types;
create policy "unit_types_authenticated_all" on public.unit_types
  for all to authenticated using (true) with check (true);

alter table public.alerts enable row level security;
drop policy if exists "alerts_authenticated_all" on public.alerts;
create policy "alerts_authenticated_all" on public.alerts
  for all to authenticated using (true) with check (true);

alter table public.allowed_quantities enable row level security;
drop policy if exists "allowed_quantities_authenticated_all" on public.allowed_quantities;
create policy "allowed_quantities_authenticated_all" on public.allowed_quantities
  for all to authenticated using (true) with check (true);

alter table public.app_config enable row level security;
drop policy if exists "app_config_authenticated_all" on public.app_config;
create policy "app_config_authenticated_all" on public.app_config
  for all to authenticated using (true) with check (true);

alter table public.daily_progress_reports enable row level security;
drop policy if exists "daily_progress_reports_authenticated_all" on public.daily_progress_reports;
create policy "daily_progress_reports_authenticated_all" on public.daily_progress_reports
  for all to authenticated using (true) with check (true);

alter table public.field_day_sessions enable row level security;
drop policy if exists "field_day_sessions_authenticated_all" on public.field_day_sessions;
create policy "field_day_sessions_authenticated_all" on public.field_day_sessions
  for all to authenticated using (true) with check (true);

alter table public.field_day_acceptances enable row level security;
drop policy if exists "field_day_acceptances_authenticated_all" on public.field_day_acceptances;
create policy "field_day_acceptances_authenticated_all" on public.field_day_acceptances
  for all to authenticated using (true) with check (true);

alter table public.sites enable row level security;
drop policy if exists "sites_authenticated_all" on public.sites;
create policy "sites_authenticated_all" on public.sites
  for all to authenticated using (true) with check (true);

alter table public.field_day_events enable row level security;
drop policy if exists "field_day_events_authenticated_all" on public.field_day_events;
create policy "field_day_events_authenticated_all" on public.field_day_events
  for all to authenticated using (true) with check (true);

alter table public.field_location_pings enable row level security;
drop policy if exists "field_location_pings_authenticated_all" on public.field_location_pings;
create policy "field_location_pings_authenticated_all" on public.field_location_pings
  for all to authenticated using (true) with check (true);

alter table public.field_photos enable row level security;
drop policy if exists "field_photos_authenticated_all" on public.field_photos;
create policy "field_photos_authenticated_all" on public.field_photos
  for all to authenticated using (true) with check (true);

alter table public.field_time_adjustments enable row level security;
drop policy if exists "field_time_adjustments_authenticated_all" on public.field_time_adjustments;
create policy "field_time_adjustments_authenticated_all" on public.field_time_adjustments
  for all to authenticated using (true) with check (true);

alter table public.field_work_logs enable row level security;
drop policy if exists "field_work_logs_authenticated_all" on public.field_work_logs;
create policy "field_work_logs_authenticated_all" on public.field_work_logs
  for all to authenticated using (true) with check (true);

alter table public.inventory_items enable row level security;
drop policy if exists "inventory_items_authenticated_all" on public.inventory_items;
create policy "inventory_items_authenticated_all" on public.inventory_items
  for all to authenticated using (true) with check (true);

alter table public.inventory_stock enable row level security;
drop policy if exists "inventory_stock_authenticated_all" on public.inventory_stock;
create policy "inventory_stock_authenticated_all" on public.inventory_stock
  for all to authenticated using (true) with check (true);

alter table public.invoice_files enable row level security;
drop policy if exists "invoice_files_authenticated_all" on public.invoice_files;
create policy "invoice_files_authenticated_all" on public.invoice_files
  for all to authenticated using (true) with check (true);

alter table public.splice_locations enable row level security;
drop policy if exists "splice_locations_authenticated_all" on public.splice_locations;
create policy "splice_locations_authenticated_all" on public.splice_locations
  for all to authenticated using (true) with check (true);

alter table public.invoices enable row level security;
drop policy if exists "invoices_authenticated_all" on public.invoices;
create policy "invoices_authenticated_all" on public.invoices
  for all to authenticated using (true) with check (true);

alter table public.work_codes enable row level security;
drop policy if exists "work_codes_authenticated_all" on public.work_codes;
create policy "work_codes_authenticated_all" on public.work_codes
  for all to authenticated using (true) with check (true);

alter table public.invoice_items enable row level security;
drop policy if exists "invoice_items_authenticated_all" on public.invoice_items;
create policy "invoice_items_authenticated_all" on public.invoice_items
  for all to authenticated using (true) with check (true);

alter table public.invoice_lines_private enable row level security;
drop policy if exists "invoice_lines_private_authenticated_all" on public.invoice_lines_private;
create policy "invoice_lines_private_authenticated_all" on public.invoice_lines_private
  for all to authenticated using (true) with check (true);

alter table public.invoice_lines_public enable row level security;
drop policy if exists "invoice_lines_public_authenticated_all" on public.invoice_lines_public;
create policy "invoice_lines_public_authenticated_all" on public.invoice_lines_public
  for all to authenticated using (true) with check (true);

alter table public.ks_invoice_import_batches enable row level security;
drop policy if exists "ks_invoice_import_batches_authenticated_all" on public.ks_invoice_import_batches;
create policy "ks_invoice_import_batches_authenticated_all" on public.ks_invoice_import_batches
  for all to authenticated using (true) with check (true);

alter table public.ks_invoice_records enable row level security;
drop policy if exists "ks_invoice_records_authenticated_all" on public.ks_invoice_records;
create policy "ks_invoice_records_authenticated_all" on public.ks_invoice_records
  for all to authenticated using (true) with check (true);

alter table public.location_proof_requirements enable row level security;
drop policy if exists "location_proof_requirements_authenticated_all" on public.location_proof_requirements;
create policy "location_proof_requirements_authenticated_all" on public.location_proof_requirements
  for all to authenticated using (true) with check (true);

alter table public.material_catalog enable row level security;
drop policy if exists "material_catalog_authenticated_all" on public.material_catalog;
create policy "material_catalog_authenticated_all" on public.material_catalog
  for all to authenticated using (true) with check (true);

alter table public.material_requirements enable row level security;
drop policy if exists "material_requirements_authenticated_all" on public.material_requirements;
create policy "material_requirements_authenticated_all" on public.material_requirements
  for all to authenticated using (true) with check (true);

alter table public.material_usage enable row level security;
drop policy if exists "material_usage_authenticated_all" on public.material_usage;
create policy "material_usage_authenticated_all" on public.material_usage
  for all to authenticated using (true) with check (true);

alter table public.messages enable row level security;
drop policy if exists "messages_authenticated_all" on public.messages;
create policy "messages_authenticated_all" on public.messages
  for all to authenticated using (true) with check (true);

alter table public.node_inventory enable row level security;
drop policy if exists "node_inventory_authenticated_all" on public.node_inventory;
create policy "node_inventory_authenticated_all" on public.node_inventory
  for all to authenticated using (true) with check (true);

alter table public.owner_overrides enable row level security;
drop policy if exists "owner_overrides_authenticated_all" on public.owner_overrides;
create policy "owner_overrides_authenticated_all" on public.owner_overrides
  for all to authenticated using (true) with check (true);

alter table public.pricing_agreements enable row level security;
drop policy if exists "pricing_agreements_authenticated_all" on public.pricing_agreements;
create policy "pricing_agreements_authenticated_all" on public.pricing_agreements
  for all to authenticated using (true) with check (true);

alter table public.prime_invoices enable row level security;
drop policy if exists "prime_invoices_authenticated_all" on public.prime_invoices;
create policy "prime_invoices_authenticated_all" on public.prime_invoices
  for all to authenticated using (true) with check (true);

alter table public.project_kmz_snapshots enable row level security;
drop policy if exists "project_kmz_snapshots_authenticated_all" on public.project_kmz_snapshots;
create policy "project_kmz_snapshots_authenticated_all" on public.project_kmz_snapshots
  for all to authenticated using (true) with check (true);

alter table public.usage_events enable row level security;
drop policy if exists "usage_events_authenticated_all" on public.usage_events;
create policy "usage_events_authenticated_all" on public.usage_events
  for all to authenticated using (true) with check (true);

alter table public.proof_uploads enable row level security;
drop policy if exists "proof_uploads_authenticated_all" on public.proof_uploads;
create policy "proof_uploads_authenticated_all" on public.proof_uploads
  for all to authenticated using (true) with check (true);

alter table public.rate_cards enable row level security;
drop policy if exists "rate_cards_authenticated_all" on public.rate_cards;
create policy "rate_cards_authenticated_all" on public.rate_cards
  for all to authenticated using (true) with check (true);

alter table public.rate_card_items enable row level security;
drop policy if exists "rate_card_items_authenticated_all" on public.rate_card_items;
create policy "rate_card_items_authenticated_all" on public.rate_card_items
  for all to authenticated using (true) with check (true);

alter table public.redline_markers enable row level security;
drop policy if exists "redline_markers_authenticated_all" on public.redline_markers;
create policy "redline_markers_authenticated_all" on public.redline_markers
  for all to authenticated using (true) with check (true);

alter table public.site_billing_codes enable row level security;
drop policy if exists "site_billing_codes_authenticated_all" on public.site_billing_codes;
create policy "site_billing_codes_authenticated_all" on public.site_billing_codes
  for all to authenticated using (true) with check (true);

alter table public.site_codes enable row level security;
drop policy if exists "site_codes_authenticated_all" on public.site_codes;
create policy "site_codes_authenticated_all" on public.site_codes
  for all to authenticated using (true) with check (true);

alter table public.site_entries enable row level security;
drop policy if exists "site_entries_authenticated_all" on public.site_entries;
create policy "site_entries_authenticated_all" on public.site_entries
  for all to authenticated using (true) with check (true);

alter table public.site_media enable row level security;
drop policy if exists "site_media_authenticated_all" on public.site_media;
create policy "site_media_authenticated_all" on public.site_media
  for all to authenticated using (true) with check (true);

alter table public.site_verification_photos enable row level security;
drop policy if exists "site_verification_photos_authenticated_all" on public.site_verification_photos;
create policy "site_verification_photos_authenticated_all" on public.site_verification_photos
  for all to authenticated using (true) with check (true);

alter table public.splice_location_photos enable row level security;
drop policy if exists "splice_location_photos_authenticated_all" on public.splice_location_photos;
create policy "splice_location_photos_authenticated_all" on public.splice_location_photos
  for all to authenticated using (true) with check (true);

alter table public.splicer_location_closeout_checklists enable row level security;
drop policy if exists "splicer_location_closeout_checklists_authenticated_all" on public.splicer_location_closeout_checklists;
create policy "splicer_location_closeout_checklists_authenticated_all" on public.splicer_location_closeout_checklists
  for all to authenticated using (true) with check (true);

alter table public.sub_invoices enable row level security;
drop policy if exists "sub_invoices_authenticated_all" on public.sub_invoices;
create policy "sub_invoices_authenticated_all" on public.sub_invoices
  for all to authenticated using (true) with check (true);

alter table public.subcontractor_agreements enable row level security;
drop policy if exists "subcontractor_agreements_authenticated_all" on public.subcontractor_agreements;
create policy "subcontractor_agreements_authenticated_all" on public.subcontractor_agreements
  for all to authenticated using (true) with check (true);

alter table public.subcontractor_documents enable row level security;
drop policy if exists "subcontractor_documents_authenticated_all" on public.subcontractor_documents;
create policy "subcontractor_documents_authenticated_all" on public.subcontractor_documents
  for all to authenticated using (true) with check (true);

alter table public.subcontractor_profiles enable row level security;
drop policy if exists "subcontractor_profiles_authenticated_all" on public.subcontractor_profiles;
create policy "subcontractor_profiles_authenticated_all" on public.subcontractor_profiles
  for all to authenticated using (true) with check (true);

alter table public.tds_price_sheet enable row level security;
drop policy if exists "tds_price_sheet_authenticated_all" on public.tds_price_sheet;
create policy "tds_price_sheet_authenticated_all" on public.tds_price_sheet
  for all to authenticated using (true) with check (true);

alter table public.technician_timesheets enable row level security;
drop policy if exists "technician_timesheets_authenticated_all" on public.technician_timesheets;
create policy "technician_timesheets_authenticated_all" on public.technician_timesheets
  for all to authenticated using (true) with check (true);

alter table public.work_orders enable row level security;
drop policy if exists "work_orders_authenticated_all" on public.work_orders;
create policy "work_orders_authenticated_all" on public.work_orders
  for all to authenticated using (true) with check (true);

alter table public.technician_time_events enable row level security;
drop policy if exists "technician_time_events_authenticated_all" on public.technician_time_events;
create policy "technician_time_events_authenticated_all" on public.technician_time_events
  for all to authenticated using (true) with check (true);

alter table public.text_translations enable row level security;
drop policy if exists "text_translations_authenticated_all" on public.text_translations;
create policy "text_translations_authenticated_all" on public.text_translations
  for all to authenticated using (true) with check (true);

alter table public.user_locations enable row level security;
drop policy if exists "user_locations_authenticated_all" on public.user_locations;
create policy "user_locations_authenticated_all" on public.user_locations
  for all to authenticated using (true) with check (true);

alter table public.work_order_events enable row level security;
drop policy if exists "work_order_events_authenticated_all" on public.work_order_events;
create policy "work_order_events_authenticated_all" on public.work_order_events
  for all to authenticated using (true) with check (true);
