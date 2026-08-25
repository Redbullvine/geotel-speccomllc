-- Inventory + KMZ expected totals + usage + alerts
-- Company-scoped material control loop for KMZ-first workflow.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers (role + org checks)
-- ---------------------------------------------------------------------------
create or replace function public.fn_material_is_company_member(p_company_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or p.org_id = p_company_id
      )
  );
$$;

create or replace function public.fn_material_is_company_admin(p_company_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          p.org_id = p_company_id
          and public.effective_role_code(p.role_code, p.role) = 'ADMIN'
        )
      )
  );
$$;

create or replace function public.fn_material_can_manage_requirements(p_company_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          p.org_id = p_company_id
          and public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER','SUPPORT')
        )
      )
  );
$$;

create or replace function public.fn_material_project_matches_company(p_project_id uuid, p_company_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.projects pr
    where pr.id = p_project_id
      and pr.org_id = p_company_id
  );
$$;

create or replace function public.fn_material_has_project_access(p_project_id uuid, p_company_id uuid default null)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.projects pr
    join public.profiles p on p.id = auth.uid()
    left join public.project_members pm
      on pm.project_id = pr.id
     and pm.user_id = auth.uid()
    where pr.id = p_project_id
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          p.org_id = pr.org_id
          and (p_company_id is null or pr.org_id = p_company_id)
          and (
            pm.user_id is not null
            or public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER','SUPPORT')
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Inventory catalog (augment existing inventory_items when present)
-- ---------------------------------------------------------------------------
alter table if exists public.inventory_items
  add column if not exists company_id uuid references public.orgs(id),
  add column if not exists item_key text,
  add column if not exists name text,
  add column if not exists vendor_code text,
  add column if not exists display_name text,
  add column if not exists active boolean,
  add column if not exists unit text,
  add column if not exists reorder_point integer,
  add column if not exists is_active boolean;

update public.inventory_items
set unit = coalesce(unit, 'ea'),
    reorder_point = coalesce(reorder_point, 0),
    is_active = coalesce(is_active, active, true),
    name = coalesce(nullif(name, ''), nullif(display_name, ''), nullif(vendor_code, ''), 'Inventory Item')
where true;

update public.inventory_items
set vendor_code = coalesce(nullif(vendor_code, ''), nullif(item_key, ''), lower(regexp_replace(coalesce(name, display_name, 'item_' || left(id::text, 8)), '[^a-zA-Z0-9]+', '_', 'g'))),
    display_name = coalesce(nullif(display_name, ''), nullif(name, ''), initcap(replace(coalesce(item_key, vendor_code, 'item'), '_', ' '))),
    active = coalesce(active, is_active, true)
where true;

update public.inventory_items i
set company_id = src.org_id
from (
  select
    ni.item_id,
    (array_agg(pr.org_id order by pr.org_id))[1] as org_id
  from public.node_inventory ni
  join public.nodes n on n.id = ni.node_id
  join public.projects pr on pr.id = n.project_id
  group by ni.item_id
) src
where i.id = src.item_id
  and i.company_id is null;

update public.inventory_items i
set company_id = src.org_id
from (
  select o.id as org_id
  from public.orgs o
  order by o.id
  limit 1
) src
where i.company_id is null
  and src.org_id is not null;

update public.inventory_items
set item_key = coalesce(
      nullif(item_key, ''),
      lower(regexp_replace(coalesce(vendor_code, display_name, name, 'item_' || left(id::text, 8)), '[^a-zA-Z0-9]+', '_', 'g'))
    )
where true;

with ranked as (
  select
    id,
    company_id,
    item_key,
    row_number() over (
      partition by company_id, item_key
      order by created_at nulls first, id
    ) as rn
  from public.inventory_items
  where company_id is not null
    and item_key is not null
)
update public.inventory_items i
set item_key = ranked.item_key || '_' || ranked.rn
from ranked
where i.id = ranked.id
  and ranked.rn > 1;

alter table public.inventory_items
  alter column company_id set not null,
  alter column item_key set not null,
  alter column name set not null,
  alter column vendor_code set default '',
  alter column display_name set default '',
  alter column active set default true,
  alter column unit set default 'ea',
  alter column unit set not null,
  alter column reorder_point set default 0,
  alter column reorder_point set not null,
  alter column is_active set default true,
  alter column is_active set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.inventory_items'::regclass
      and conname = 'inventory_items_vendor_code_key'
  ) then
    alter table public.inventory_items drop constraint inventory_items_vendor_code_key;
  end if;
end;
$$;

create unique index if not exists inventory_items_company_item_key_idx
  on public.inventory_items (company_id, item_key);

create unique index if not exists inventory_items_company_vendor_code_idx
  on public.inventory_items (company_id, vendor_code)
  where nullif(vendor_code, '') is not null;

create index if not exists inventory_items_company_active_idx
  on public.inventory_items (company_id, is_active);

-- ---------------------------------------------------------------------------
-- Inventory stock
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_stock (
  company_id uuid not null references public.orgs(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  on_hand integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_id, item_id)
);

create or replace function public.set_inventory_stock_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_inventory_stock_updated_at on public.inventory_stock;
create trigger trg_inventory_stock_updated_at
before update on public.inventory_stock
for each row execute function public.set_inventory_stock_updated_at();

-- ---------------------------------------------------------------------------
-- KMZ expected requirements + structured usage
-- ---------------------------------------------------------------------------
create table if not exists public.material_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  feature_id text not null,
  item_key text not null,
  qty_required integer not null default 1,
  raw_label text,
  source text not null default 'kmz',
  created_at timestamptz not null default now(),
  unique (company_id, project_id, feature_id, item_key)
);

create index if not exists material_requirements_project_item_idx
  on public.material_requirements (company_id, project_id, item_key);

create index if not exists material_requirements_feature_idx
  on public.material_requirements (company_id, project_id, feature_id);

create table if not exists public.material_usage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  feature_id text not null,
  item_key text not null,
  qty_used integer not null default 1,
  used_by uuid not null references auth.users(id),
  used_at timestamptz not null default now()
);

create index if not exists material_usage_project_item_idx
  on public.material_usage (company_id, project_id, item_key, used_at desc);

create index if not exists material_usage_feature_idx
  on public.material_usage (company_id, project_id, feature_id, item_key);

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------
create table if not exists public.alert_subscriptions (
  company_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text not null,
  sms_enabled boolean not null default false,
  cooldown_minutes integer not null default 30,
  primary key (company_id, user_id)
);

create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.orgs(id) on delete cascade,
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
  unique (company_id, project_id, item_key, alert_type, expected_qty)
);

alter table public.alert_events
  drop constraint if exists alert_events_alert_type_check;

alter table public.alert_events
  add constraint alert_events_alert_type_check
  check (alert_type in ('LOW_STOCK','EXCEEDED_PLAN'));

create index if not exists alert_events_open_idx
  on public.alert_events (company_id, project_id, is_open, created_at desc);

create index if not exists alert_events_item_idx
  on public.alert_events (company_id, project_id, item_key, alert_type);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.inventory_items enable row level security;
alter table public.inventory_stock enable row level security;
alter table public.material_requirements enable row level security;
alter table public.material_usage enable row level security;
alter table public.alert_subscriptions enable row level security;
alter table public.alert_events enable row level security;

-- inventory_items
drop policy if exists "inventory_items_read_all_authed" on public.inventory_items;
drop policy if exists "inventory_items_write_owner_tds" on public.inventory_items;
drop policy if exists "inventory_items_update_owner_tds" on public.inventory_items;
drop policy if exists "inventory_items_select_company" on public.inventory_items;
drop policy if exists "inventory_items_insert_admin" on public.inventory_items;
drop policy if exists "inventory_items_update_admin" on public.inventory_items;
drop policy if exists "inventory_items_delete_admin" on public.inventory_items;

create policy "inventory_items_select_company"
on public.inventory_items for select
to authenticated
using (public.fn_material_is_company_member(company_id));

create policy "inventory_items_insert_admin"
on public.inventory_items for insert
to authenticated
with check (public.fn_material_is_company_admin(company_id));

create policy "inventory_items_update_admin"
on public.inventory_items for update
to authenticated
using (public.fn_material_is_company_admin(company_id))
with check (public.fn_material_is_company_admin(company_id));

create policy "inventory_items_delete_admin"
on public.inventory_items for delete
to authenticated
using (public.fn_material_is_company_admin(company_id));

-- inventory_stock
drop policy if exists "inventory_stock_select_company" on public.inventory_stock;
drop policy if exists "inventory_stock_insert_admin" on public.inventory_stock;
drop policy if exists "inventory_stock_update_admin" on public.inventory_stock;
drop policy if exists "inventory_stock_delete_admin" on public.inventory_stock;

create policy "inventory_stock_select_company"
on public.inventory_stock for select
to authenticated
using (public.fn_material_is_company_member(company_id));

create policy "inventory_stock_insert_admin"
on public.inventory_stock for insert
to authenticated
with check (public.fn_material_is_company_admin(company_id));

create policy "inventory_stock_update_admin"
on public.inventory_stock for update
to authenticated
using (public.fn_material_is_company_admin(company_id))
with check (public.fn_material_is_company_admin(company_id));

create policy "inventory_stock_delete_admin"
on public.inventory_stock for delete
to authenticated
using (public.fn_material_is_company_admin(company_id));

-- material_requirements
drop policy if exists "material_requirements_select_company" on public.material_requirements;
drop policy if exists "material_requirements_insert_manager" on public.material_requirements;
drop policy if exists "material_requirements_update_manager" on public.material_requirements;
drop policy if exists "material_requirements_delete_manager" on public.material_requirements;

create policy "material_requirements_select_company"
on public.material_requirements for select
to authenticated
using (
  public.fn_material_is_company_member(company_id)
  and public.fn_material_has_project_access(project_id, company_id)
);

create policy "material_requirements_insert_manager"
on public.material_requirements for insert
to authenticated
with check (
  public.fn_material_can_manage_requirements(company_id)
  and public.fn_material_project_matches_company(project_id, company_id)
);

create policy "material_requirements_update_manager"
on public.material_requirements for update
to authenticated
using (
  public.fn_material_can_manage_requirements(company_id)
  and public.fn_material_project_matches_company(project_id, company_id)
)
with check (
  public.fn_material_can_manage_requirements(company_id)
  and public.fn_material_project_matches_company(project_id, company_id)
);

create policy "material_requirements_delete_manager"
on public.material_requirements for delete
to authenticated
using (
  public.fn_material_can_manage_requirements(company_id)
  and public.fn_material_project_matches_company(project_id, company_id)
);

-- material_usage
drop policy if exists "material_usage_select_company" on public.material_usage;
drop policy if exists "material_usage_insert_project_member" on public.material_usage;

create policy "material_usage_select_company"
on public.material_usage for select
to authenticated
using (
  public.fn_material_is_company_member(company_id)
  and public.fn_material_has_project_access(project_id, company_id)
);

create policy "material_usage_insert_project_member"
on public.material_usage for insert
to authenticated
with check (
  used_by = auth.uid()
  and public.fn_material_is_company_member(company_id)
  and public.fn_material_project_matches_company(project_id, company_id)
  and public.fn_material_has_project_access(project_id, company_id)
);

-- alert_subscriptions
drop policy if exists "alert_subscriptions_select_company" on public.alert_subscriptions;
drop policy if exists "alert_subscriptions_insert_admin" on public.alert_subscriptions;
drop policy if exists "alert_subscriptions_update_admin" on public.alert_subscriptions;
drop policy if exists "alert_subscriptions_delete_admin" on public.alert_subscriptions;

create policy "alert_subscriptions_select_company"
on public.alert_subscriptions for select
to authenticated
using (
  public.fn_material_is_company_member(company_id)
  and (
    user_id = auth.uid()
    or public.fn_material_is_company_admin(company_id)
  )
);

create policy "alert_subscriptions_insert_admin"
on public.alert_subscriptions for insert
to authenticated
with check (public.fn_material_is_company_admin(company_id));

create policy "alert_subscriptions_update_admin"
on public.alert_subscriptions for update
to authenticated
using (public.fn_material_is_company_admin(company_id))
with check (public.fn_material_is_company_admin(company_id));

create policy "alert_subscriptions_delete_admin"
on public.alert_subscriptions for delete
to authenticated
using (public.fn_material_is_company_admin(company_id));

-- alert_events
drop policy if exists "alert_events_select_company" on public.alert_events;
drop policy if exists "alert_events_insert_admin" on public.alert_events;
drop policy if exists "alert_events_update_admin" on public.alert_events;

create policy "alert_events_select_company"
on public.alert_events for select
to authenticated
using (
  public.fn_material_is_company_member(company_id)
  and public.fn_material_has_project_access(project_id, company_id)
);

create policy "alert_events_insert_admin"
on public.alert_events for insert
to authenticated
with check (public.fn_material_is_company_admin(company_id));

create policy "alert_events_update_admin"
on public.alert_events for update
to authenticated
using (public.fn_material_is_company_admin(company_id))
with check (public.fn_material_is_company_admin(company_id));

-- ---------------------------------------------------------------------------
-- Core functions
-- ---------------------------------------------------------------------------
create or replace function public.fn_ensure_material_inventory_defaults(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.inventory_items (
    company_id,
    item_key,
    name,
    vendor_code,
    display_name,
    active,
    unit,
    reorder_point,
    is_active
  )
  values
    (p_company_id, 'splice_closure', 'Splice Closure', 'splice_closure', 'Splice Closure', true, 'ea', 0, true),
    (p_company_id, 'splitter_1x4', 'Splitter 1x4', 'splitter_1x4', 'Splitter 1x4', true, 'ea', 0, true),
    (p_company_id, 'splitter_1x8', 'Splitter 1x8', 'splitter_1x8', 'Splitter 1x8', true, 'ea', 0, true)
  on conflict (company_id, item_key)
  do update set
    name = excluded.name,
    vendor_code = coalesce(nullif(public.inventory_items.vendor_code, ''), excluded.vendor_code),
    display_name = coalesce(nullif(public.inventory_items.display_name, ''), excluded.display_name),
    active = true,
    unit = coalesce(public.inventory_items.unit, excluded.unit),
    is_active = true;
end;
$$;

create or replace function public.fn_material_eval_alerts(
  p_company_id uuid,
  p_project_id uuid,
  p_item_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_item_key text := lower(trim(coalesce(p_item_key, '')));
  v_project_name text := '';
  v_expected integer := 0;
  v_used integer := 0;
  v_on_hand integer := null;
  v_reorder integer := 0;
  v_msg text;
  v_event record;
  v_alerts jsonb := '[]'::jsonb;
begin
  if v_item_key = '' then
    return v_alerts;
  end if;

  select coalesce(name, '')
    into v_project_name
  from public.projects
  where id = p_project_id;

  select coalesce(sum(qty_required), 0)
    into v_expected
  from public.material_requirements
  where company_id = p_company_id
    and project_id = p_project_id
    and item_key = v_item_key;

  select coalesce(sum(qty_used), 0)
    into v_used
  from public.material_usage
  where company_id = p_company_id
    and project_id = p_project_id
    and item_key = v_item_key;

  select s.on_hand, coalesce(i.reorder_point, 0)
    into v_on_hand, v_reorder
  from public.inventory_items i
  left join public.inventory_stock s
    on s.company_id = i.company_id
   and s.item_id = i.id
  where i.company_id = p_company_id
    and i.item_key = v_item_key
  limit 1;

  if v_used > v_expected then
    v_msg := format(
      'Exceeded plan: %s used %s vs planned %s%s',
      v_item_key,
      v_used,
      v_expected,
      case when v_project_name <> '' then format(' (Project %s)', v_project_name) else '' end
    );

    insert into public.alert_events (
      company_id, project_id, item_key, alert_type,
      expected_qty, actual_qty, on_hand, message, is_open
    )
    values (
      p_company_id, p_project_id, v_item_key, 'EXCEEDED_PLAN',
      v_expected, v_used, v_on_hand, v_msg, true
    )
    on conflict (company_id, project_id, item_key, alert_type, expected_qty)
    do update set
      actual_qty = excluded.actual_qty,
      on_hand = excluded.on_hand,
      message = excluded.message,
      is_open = true
    returning * into v_event;

    v_alerts := v_alerts || jsonb_build_array(
      jsonb_build_object(
        'id', v_event.id,
        'item_key', v_item_key,
        'alert_type', 'EXCEEDED_PLAN',
        'message', v_event.message,
        'expected_qty', v_event.expected_qty,
        'actual_qty', v_event.actual_qty,
        'on_hand', v_event.on_hand,
        'last_sent_at', v_event.last_sent_at
      )
    );
  else
    update public.alert_events
    set is_open = false
    where company_id = p_company_id
      and project_id = p_project_id
      and item_key = v_item_key
      and alert_type = 'EXCEEDED_PLAN'
      and is_open = true;
  end if;

  if v_on_hand is not null and v_on_hand <= v_reorder then
    v_msg := format(
      'Low stock: %s on hand %s (reorder point %s)',
      v_item_key,
      v_on_hand,
      v_reorder
    );

    insert into public.alert_events (
      company_id, project_id, item_key, alert_type,
      expected_qty, actual_qty, on_hand, message, is_open
    )
    values (
      p_company_id, p_project_id, v_item_key, 'LOW_STOCK',
      v_reorder, null, v_on_hand, v_msg, true
    )
    on conflict (company_id, project_id, item_key, alert_type, expected_qty)
    do update set
      on_hand = excluded.on_hand,
      message = excluded.message,
      is_open = true
    returning * into v_event;

    v_alerts := v_alerts || jsonb_build_array(
      jsonb_build_object(
        'id', v_event.id,
        'item_key', v_item_key,
        'alert_type', 'LOW_STOCK',
        'message', v_event.message,
        'expected_qty', v_event.expected_qty,
        'actual_qty', v_event.actual_qty,
        'on_hand', v_event.on_hand,
        'last_sent_at', v_event.last_sent_at
      )
    );
  else
    update public.alert_events
    set is_open = false
    where company_id = p_company_id
      and project_id = p_project_id
      and item_key = v_item_key
      and alert_type = 'LOW_STOCK'
      and is_open = true;
  end if;

  return v_alerts;
end;
$$;

create or replace function public.fn_get_material_project_totals(p_project_id uuid)
returns table (
  item_key text,
  item_name text,
  unit text,
  expected_total integer,
  used_total integer,
  remaining integer,
  on_hand integer,
  reorder_point integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select pr.org_id
    into v_company_id
  from public.projects pr
  where pr.id = p_project_id;

  if v_company_id is null then
    raise exception 'Project not found';
  end if;

  if not public.fn_material_has_project_access(p_project_id, v_company_id) then
    raise exception 'Not authorized for project';
  end if;

  return query
  with req as (
    select item_key, sum(qty_required)::integer as expected_total
    from public.material_requirements
    where company_id = v_company_id
      and project_id = p_project_id
    group by item_key
  ),
  used as (
    select item_key, sum(qty_used)::integer as used_total
    from public.material_usage
    where company_id = v_company_id
      and project_id = p_project_id
    group by item_key
  ),
  keys as (
    select item_key from req
    union
    select item_key from used
    union
    select i.item_key
    from public.inventory_items i
    where i.company_id = v_company_id
      and i.is_active = true
  )
  select
    k.item_key,
    coalesce(i.name, initcap(replace(k.item_key, '_', ' '))) as item_name,
    coalesce(i.unit, 'ea') as unit,
    coalesce(r.expected_total, 0) as expected_total,
    coalesce(u.used_total, 0) as used_total,
    coalesce(r.expected_total, 0) - coalesce(u.used_total, 0) as remaining,
    coalesce(s.on_hand, 0) as on_hand,
    coalesce(i.reorder_point, 0) as reorder_point
  from keys k
  left join req r on r.item_key = k.item_key
  left join used u on u.item_key = k.item_key
  left join public.inventory_items i
    on i.company_id = v_company_id
   and i.item_key = k.item_key
  left join public.inventory_stock s
    on s.company_id = v_company_id
   and s.item_id = i.id
  order by item_name;
end;
$$;

create or replace function public.fn_get_material_feature_totals(
  p_project_id uuid,
  p_feature_id text
)
returns table (
  item_key text,
  item_name text,
  unit text,
  expected_qty integer,
  used_qty integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_company_id uuid;
  v_feature_id text := trim(coalesce(p_feature_id, ''));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if v_feature_id = '' then
    raise exception 'Feature id required';
  end if;

  select pr.org_id
    into v_company_id
  from public.projects pr
  where pr.id = p_project_id;

  if v_company_id is null then
    raise exception 'Project not found';
  end if;

  if not public.fn_material_has_project_access(p_project_id, v_company_id) then
    raise exception 'Not authorized for project';
  end if;

  return query
  with req as (
    select item_key, sum(qty_required)::integer as expected_qty
    from public.material_requirements
    where company_id = v_company_id
      and project_id = p_project_id
      and feature_id = v_feature_id
    group by item_key
  ),
  used as (
    select item_key, sum(qty_used)::integer as used_qty
    from public.material_usage
    where company_id = v_company_id
      and project_id = p_project_id
      and feature_id = v_feature_id
    group by item_key
  ),
  keys as (
    select item_key from req
    union
    select item_key from used
  )
  select
    k.item_key,
    coalesce(i.name, initcap(replace(k.item_key, '_', ' '))) as item_name,
    coalesce(i.unit, 'ea') as unit,
    coalesce(r.expected_qty, 0) as expected_qty,
    coalesce(u.used_qty, 0) as used_qty
  from keys k
  left join req r on r.item_key = k.item_key
  left join used u on u.item_key = k.item_key
  left join public.inventory_items i
    on i.company_id = v_company_id
   and i.item_key = k.item_key
  order by item_name;
end;
$$;

create or replace function public.fn_get_material_open_alerts(p_project_id uuid)
returns table (
  id uuid,
  item_key text,
  alert_type text,
  expected_qty integer,
  actual_qty integer,
  on_hand integer,
  message text,
  created_at timestamptz,
  last_sent_at timestamptz,
  is_open boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select pr.org_id
    into v_company_id
  from public.projects pr
  where pr.id = p_project_id;

  if v_company_id is null then
    raise exception 'Project not found';
  end if;

  if not public.fn_material_has_project_access(p_project_id, v_company_id) then
    raise exception 'Not authorized for project';
  end if;

  return query
  select
    ae.id,
    ae.item_key,
    ae.alert_type,
    ae.expected_qty,
    ae.actual_qty,
    ae.on_hand,
    ae.message,
    ae.created_at,
    ae.last_sent_at,
    ae.is_open
  from public.alert_events ae
  where ae.company_id = v_company_id
    and ae.project_id = p_project_id
    and ae.is_open = true
  order by ae.created_at desc;
end;
$$;

create or replace function public.fn_sync_material_requirements(
  p_project_id uuid,
  p_requirements jsonb,
  p_replace_existing boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_code text;
  v_org_id uuid;
  v_company_id uuid;
  v_row jsonb;
  v_feature_id text;
  v_item_key text;
  v_qty integer;
  v_raw_label text;
  v_upserted integer := 0;
  v_alerts jsonb := '[]'::jsonb;
  v_item record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select public.effective_role_code(p.role_code, p.role), p.org_id
    into v_role_code, v_org_id
  from public.profiles p
  where p.id = v_user_id;

  select pr.org_id
    into v_company_id
  from public.projects pr
  where pr.id = p_project_id;

  if v_company_id is null then
    raise exception 'Project not found';
  end if;

  if v_role_code is null or v_role_code not in ('ROOT','OWNER','ADMIN','PROJECT_MANAGER','SUPPORT') then
    raise exception 'Not authorized';
  end if;

  if v_role_code <> 'ROOT' and (v_org_id is null or v_org_id <> v_company_id) then
    raise exception 'Not authorized for project org';
  end if;

  if p_requirements is null or jsonb_typeof(p_requirements) <> 'array' then
    raise exception 'Invalid requirements payload';
  end if;

  perform public.fn_ensure_material_inventory_defaults(v_company_id);

  if p_replace_existing then
    delete from public.material_requirements
    where company_id = v_company_id
      and project_id = p_project_id
      and source = 'kmz';
  end if;

  for v_row in select * from jsonb_array_elements(p_requirements)
  loop
    v_feature_id := trim(coalesce(v_row->>'feature_id', ''));
    v_item_key := lower(trim(coalesce(v_row->>'item_key', '')));
    v_qty := greatest(coalesce((v_row->>'qty_required')::integer, 0), 0);
    v_raw_label := nullif(trim(coalesce(v_row->>'raw_label', '')), '');

    if v_feature_id = '' or v_item_key = '' or v_qty <= 0 then
      continue;
    end if;

    insert into public.material_requirements (
      company_id, project_id, feature_id, item_key, qty_required, raw_label, source
    )
    values (
      v_company_id, p_project_id, v_feature_id, v_item_key, v_qty, v_raw_label, 'kmz'
    )
    on conflict (company_id, project_id, feature_id, item_key)
    do update set
      qty_required = excluded.qty_required,
      raw_label = excluded.raw_label,
      source = excluded.source;

    v_upserted := v_upserted + 1;
  end loop;

  for v_item in
    select distinct item_key
    from public.material_requirements
    where company_id = v_company_id
      and project_id = p_project_id
  loop
    v_alerts := v_alerts || coalesce(public.fn_material_eval_alerts(v_company_id, p_project_id, v_item.item_key), '[]'::jsonb);
  end loop;

  return jsonb_build_object(
    'company_id', v_company_id,
    'project_id', p_project_id,
    'upserted', v_upserted,
    'totals', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from public.fn_get_material_project_totals(p_project_id) t
    ),
    'alerts', v_alerts
  );
end;
$$;

create or replace function public.fn_record_material_usage(
  p_project_id uuid,
  p_feature_id text,
  p_item_key text,
  p_qty_used integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_code text;
  v_org_id uuid;
  v_company_id uuid;
  v_feature_id text := trim(coalesce(p_feature_id, ''));
  v_item_key text := lower(trim(coalesce(p_item_key, '')));
  v_qty integer := greatest(coalesce(p_qty_used, 1), 1);
  v_usage_id uuid;
  v_alerts jsonb := '[]'::jsonb;
  v_totals jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if v_feature_id = '' then
    raise exception 'Feature id required';
  end if;
  if v_item_key = '' then
    raise exception 'Item key required';
  end if;

  select public.effective_role_code(p.role_code, p.role), p.org_id
    into v_role_code, v_org_id
  from public.profiles p
  where p.id = v_user_id;

  select pr.org_id
    into v_company_id
  from public.projects pr
  where pr.id = p_project_id;

  if v_company_id is null then
    raise exception 'Project not found';
  end if;

  if v_role_code is null then
    raise exception 'Not authorized';
  end if;

  if v_role_code <> 'ROOT' and (v_org_id is null or v_org_id <> v_company_id) then
    raise exception 'Not authorized for project org';
  end if;

  if not public.fn_material_has_project_access(p_project_id, v_company_id) then
    raise exception 'No project access';
  end if;

  perform public.fn_ensure_material_inventory_defaults(v_company_id);

  insert into public.material_usage (
    company_id, project_id, feature_id, item_key, qty_used, used_by
  )
  values (
    v_company_id, p_project_id, v_feature_id, v_item_key, v_qty, v_user_id
  )
  returning id into v_usage_id;

  v_alerts := coalesce(public.fn_material_eval_alerts(v_company_id, p_project_id, v_item_key), '[]'::jsonb);

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    into v_totals
  from public.fn_get_material_project_totals(p_project_id) t;

  return jsonb_build_object(
    'usage_id', v_usage_id,
    'company_id', v_company_id,
    'project_id', p_project_id,
    'feature_id', v_feature_id,
    'item_key', v_item_key,
    'qty_used', v_qty,
    'alerts', v_alerts,
    'totals', v_totals
  );
end;
$$;

create or replace function public.fn_set_inventory_stock(
  p_project_id uuid,
  p_item_key text,
  p_on_hand integer,
  p_reorder_point integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_code text;
  v_org_id uuid;
  v_company_id uuid;
  v_item_key text := lower(trim(coalesce(p_item_key, '')));
  v_item_id uuid;
  v_on_hand integer := coalesce(p_on_hand, 0);
  v_alerts jsonb := '[]'::jsonb;
  v_totals jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if v_item_key = '' then
    raise exception 'Item key required';
  end if;

  select public.effective_role_code(p.role_code, p.role), p.org_id
    into v_role_code, v_org_id
  from public.profiles p
  where p.id = v_user_id;

  select pr.org_id
    into v_company_id
  from public.projects pr
  where pr.id = p_project_id;

  if v_company_id is null then
    raise exception 'Project not found';
  end if;

  if v_role_code is null or v_role_code not in ('ROOT','ADMIN') then
    raise exception 'Only ADMIN/ROOT can edit inventory';
  end if;

  if v_role_code <> 'ROOT' and (v_org_id is null or v_org_id <> v_company_id) then
    raise exception 'Not authorized for project org';
  end if;

  perform public.fn_ensure_material_inventory_defaults(v_company_id);

  select id
    into v_item_id
  from public.inventory_items
  where company_id = v_company_id
    and item_key = v_item_key
  limit 1;

  if v_item_id is null then
    insert into public.inventory_items (
      company_id,
      item_key,
      name,
      vendor_code,
      display_name,
      active,
      unit,
      reorder_point,
      is_active
    )
    values (
      v_company_id,
      v_item_key,
      initcap(replace(v_item_key, '_', ' ')),
      v_item_key,
      initcap(replace(v_item_key, '_', ' ')),
      true,
      'ea',
      coalesce(p_reorder_point, 0),
      true
    )
    returning id into v_item_id;
  end if;

  if p_reorder_point is not null then
    update public.inventory_items
    set reorder_point = greatest(p_reorder_point, 0)
    where id = v_item_id;
  end if;

  insert into public.inventory_stock (company_id, item_id, on_hand)
  values (v_company_id, v_item_id, v_on_hand)
  on conflict (company_id, item_id)
  do update set
    on_hand = excluded.on_hand,
    updated_at = now();

  v_alerts := coalesce(public.fn_material_eval_alerts(v_company_id, p_project_id, v_item_key), '[]'::jsonb);

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    into v_totals
  from public.fn_get_material_project_totals(p_project_id) t;

  return jsonb_build_object(
    'company_id', v_company_id,
    'project_id', p_project_id,
    'item_key', v_item_key,
    'on_hand', v_on_hand,
    'alerts', v_alerts,
    'totals', v_totals
  );
end;
$$;

create or replace function public.fn_save_alert_subscription(
  p_company_id uuid,
  p_user_id uuid,
  p_phone_e164 text,
  p_sms_enabled boolean,
  p_cooldown_minutes integer default 30
)
returns public.alert_subscriptions
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role_code text;
  v_org_id uuid;
  v_target_user_id uuid := coalesce(p_user_id, auth.uid());
  v_row public.alert_subscriptions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select public.effective_role_code(p.role_code, p.role), p.org_id
    into v_role_code, v_org_id
  from public.profiles p
  where p.id = auth.uid();

  if v_role_code is null or v_role_code not in ('ROOT','ADMIN') then
    raise exception 'Only ADMIN/ROOT can edit subscriptions';
  end if;

  if v_role_code <> 'ROOT' and (v_org_id is null or v_org_id <> p_company_id) then
    raise exception 'Not authorized for company';
  end if;

  insert into public.alert_subscriptions (
    company_id, user_id, phone_e164, sms_enabled, cooldown_minutes
  )
  values (
    p_company_id,
    v_target_user_id,
    trim(coalesce(p_phone_e164, '')),
    coalesce(p_sms_enabled, false),
    greatest(coalesce(p_cooldown_minutes, 30), 1)
  )
  on conflict (company_id, user_id)
  do update set
    phone_e164 = excluded.phone_e164,
    sms_enabled = excluded.sms_enabled,
    cooldown_minutes = excluded.cooldown_minutes
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.fn_ensure_material_inventory_defaults(uuid) from public;
revoke all on function public.fn_material_eval_alerts(uuid, uuid, text) from public;

revoke all on function public.fn_get_material_project_totals(uuid) from public;
revoke all on function public.fn_get_material_feature_totals(uuid, text) from public;
revoke all on function public.fn_get_material_open_alerts(uuid) from public;
revoke all on function public.fn_sync_material_requirements(uuid, jsonb, boolean) from public;
revoke all on function public.fn_record_material_usage(uuid, text, text, integer) from public;
revoke all on function public.fn_set_inventory_stock(uuid, text, integer, integer) from public;
revoke all on function public.fn_save_alert_subscription(uuid, uuid, text, boolean, integer) from public;

grant execute on function public.fn_get_material_project_totals(uuid) to authenticated;
grant execute on function public.fn_get_material_feature_totals(uuid, text) to authenticated;
grant execute on function public.fn_get_material_open_alerts(uuid) to authenticated;
grant execute on function public.fn_sync_material_requirements(uuid, jsonb, boolean) to authenticated;
grant execute on function public.fn_record_material_usage(uuid, text, text, integer) to authenticated;
grant execute on function public.fn_set_inventory_stock(uuid, text, integer, integer) to authenticated;
grant execute on function public.fn_save_alert_subscription(uuid, uuid, text, boolean, integer) to authenticated;

notify pgrst, 'reload schema';
