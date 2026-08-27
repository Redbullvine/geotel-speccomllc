-- SpecCom V2 foundation: additive only.  This migration intentionally does not
-- delete or alter existing V1 project data or authorization policies.
--
-- Worker access uses an opaque, short-lived project-session cookie that is
-- validated by a server-side BFF.  Browser clients must not query V2 tables
-- directly; service credentials stay on the server.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.project_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  display_name text not null,
  description text,
  default_configuration jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep projects.id as the canonical UUID.  V1 rows can be incrementally
-- backfilled with company/customer/template metadata before V2 is activated.
alter table public.projects add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.projects add column if not exists customer_id uuid references public.customers(id) on delete restrict;
alter table public.projects add column if not exists template_id uuid references public.project_templates(id) on delete set null;
alter table public.projects add column if not exists v2_status text not null default 'draft' check (v2_status in ('draft', 'active', 'suspended', 'archived'));
alter table public.projects add column if not exists v2_configuration jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists v2_activated_at timestamptz;
create index if not exists projects_v2_company_customer_idx on public.projects(company_id, customer_id);

create table if not exists public.module_registry (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  display_name text not null,
  description text not null default '',
  route text not null,
  icon_key text,
  dependencies text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.project_modules (
  project_id uuid not null references public.projects(id) on delete cascade,
  module_key text not null references public.module_registry(key) on delete restrict,
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (project_id, module_key)
);

-- Only a hash is stored.  The value distributed to a field worker is never
-- queryable from the database.  It is generated and shown once by owner APIs.
create table if not exists public.project_access_codes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  code_hash text not null unique,
  code_hint text not null check (length(code_hint) between 4 and 24),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  rotated_from_id uuid references public.project_access_codes(id) on delete set null,
  check ((status <> 'revoked') or revoked_at is not null)
);
create unique index if not exists project_access_codes_one_active_per_project
  on public.project_access_codes(project_id) where status = 'active';

-- Opaque bearer session. token_hash is SHA-256 of a 256-bit random token; the
-- raw token exists only in a Secure, HttpOnly, SameSite cookie.
create table if not exists public.project_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  access_code_id uuid references public.project_access_codes(id) on delete set null,
  token_hash text not null unique,
  mode text not null default 'worker' check (mode in ('worker', 'owner_maintenance', 'owner_preview')),
  owner_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  check ((mode = 'worker' and owner_user_id is null) or (mode <> 'worker' and owner_user_id is not null))
);
create index if not exists project_sessions_active_lookup_idx
  on public.project_sessions(token_hash, expires_at) where revoked_at is null;

-- A server-only, hashed key keeps Gateway abuse counters without retaining raw
-- IP addresses.  The BFF uses a trusted edge-provided address as its input.
create table if not exists public.project_gateway_rate_limits (
  fingerprint_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.owner_audit_log (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  action text not null,
  category text not null,
  before_value jsonb,
  after_value jsonb,
  request_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists owner_audit_log_project_created_idx on public.owner_audit_log(project_id, created_at desc);

alter table public.companies enable row level security;
alter table public.customers enable row level security;
alter table public.project_templates enable row level security;
alter table public.module_registry enable row level security;
alter table public.project_modules enable row level security;
alter table public.project_access_codes enable row level security;
alter table public.project_sessions enable row level security;
alter table public.project_gateway_rate_limits enable row level security;
alter table public.platform_owners enable row level security;
alter table public.owner_audit_log enable row level security;

-- No browser-direct policies are intentionally created.  V2's server-side
-- Project Session service is the only normal-worker access path.
revoke all on public.companies, public.customers, public.project_templates,
  public.module_registry, public.project_modules, public.project_access_codes,
  public.project_sessions, public.project_gateway_rate_limits, public.platform_owners, public.owner_audit_log
  from anon, authenticated;

insert into public.module_registry (key, display_name, description, route, icon_key)
values
  ('dashboard', 'Project Home', 'Project-specific landing workspace.', '#home', 'home'),
  ('tasks', 'Tasks', 'Assigned and unassigned field tasks.', '#tasks', 'check-square'),
  ('trouble_tickets', 'Trouble Tickets', 'Field issue intake and resolution.', '#trouble-tickets', 'alert-triangle'),
  ('project_map', 'Project Map', 'Project map, sites, and locations.', '#map', 'map'),
  ('nodes', 'Nodes', 'Network or asset nodes.', '#nodes', 'box'),
  ('poles', 'Poles', 'Pole and attachment records.', '#poles', 'git-branch'),
  ('fiber_art', 'Fiber Art', 'Fiber design and visual records.', '#fiber-art', 'share-2'),
  ('staking_sheets', 'Staking Sheets', 'Field staking records.', '#staking', 'clipboard'),
  ('splicing', 'Splicing', 'Splice locations and work.', '#splicing', 'scissors'),
  ('test_readings', 'Test Readings', 'Test and optical readings.', '#test-readings', 'activity'),
  ('redline', 'Redlines', 'Field redline drawings and markers.', '#redline', 'edit-3'),
  ('photos', 'Photos', 'Field photos and verification.', '#photos', 'camera'),
  ('gps', 'GPS', 'GPS and field locations.', '#gps', 'navigation'),
  ('documents', 'Documents', 'Project documents and files.', '#documents', 'file-text'),
  ('daily_reports', 'Daily Reports', 'Daily field reports.', '#daily-reports', 'calendar'),
  ('equipment', 'Equipment', 'Project equipment records.', '#equipment', 'tool'),
  ('invoices', 'Invoices', 'Project billing records.', '#invoices', 'dollar-sign')
on conflict (key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  route = excluded.route,
  icon_key = excluded.icon_key;

-- Explicitly reserved for the server-only Project Session service.  It is
-- deliberately not exposed to anon/authenticated roles.
create or replace function public.v2_validate_project_session(p_token_hash text)
returns table(project_id uuid, mode text, owner_user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select ps.project_id, ps.mode, ps.owner_user_id
  from public.project_sessions ps
  join public.projects p on p.id = ps.project_id
  where ps.token_hash = p_token_hash
    and ps.revoked_at is null
    and ps.expires_at > now()
    and p.v2_status = 'active'
  limit 1;
$$;
revoke all on function public.v2_validate_project_session(text) from public, anon, authenticated;

-- The project JWT is minted only by the BFF with an imported asymmetric
-- Supabase signing key. This function is the RLS bridge for every V2
-- project-owned table: it verifies the JWT's immutable project/session claims
-- against live server-side session state, so expiry, revocation, and project
-- suspension are enforced even if a token is replayed.
create or replace function public.v2_authorized_project_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select ps.project_id
  from public.project_sessions ps
  join public.projects p on p.id = ps.project_id
  where coalesce(auth.jwt() ->> 'access_kind', '') = 'project_session'
    and coalesce(auth.jwt() ->> 'project_session_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(auth.jwt() ->> 'project_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and ps.id = (auth.jwt() ->> 'project_session_id')::uuid
    and ps.project_id = (auth.jwt() ->> 'project_id')::uuid
    and ps.revoked_at is null
    and ps.expires_at > now()
    and p.v2_status = 'active'
  limit 1;
$$;
revoke all on function public.v2_authorized_project_id() from public, anon;
grant execute on function public.v2_authorized_project_id() to authenticated;

grant select on public.project_modules to authenticated;
create policy "v2_project_modules_select"
on public.project_modules for select to authenticated
using (project_id = (select public.v2_authorized_project_id()));

-- Atomic fixed-window limit: 8 Gateway attempts per hashed client fingerprint
-- per five minutes.  This function is callable only by the server-side BFF.
create or replace function public.v2_consume_gateway_attempt(p_fingerprint_hash text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  allowed boolean;
begin
  if p_fingerprint_hash is null or length(p_fingerprint_hash) <> 64 then
    return false;
  end if;
  insert into public.project_gateway_rate_limits as rl
    (fingerprint_hash, window_started_at, attempt_count, updated_at)
  values (p_fingerprint_hash, now(), 1, now())
  on conflict (fingerprint_hash) do update
    set window_started_at = case
          when rl.window_started_at <= now() - interval '5 minutes' then now()
          else rl.window_started_at
        end,
        attempt_count = case
          when rl.window_started_at <= now() - interval '5 minutes' then 1
          else rl.attempt_count + 1
        end,
        updated_at = now()
  returning attempt_count <= 8 into allowed;
  return coalesce(allowed, false);
end;
$$;
revoke all on function public.v2_consume_gateway_attempt(text) from public, anon, authenticated;
