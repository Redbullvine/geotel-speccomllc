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
    select mr.item_key as item_key, sum(mr.qty_required)::integer as expected_total
    from public.material_requirements mr
    where mr.company_id = v_company_id
      and mr.project_id = p_project_id
    group by mr.item_key
  ),
  used as (
    select mu.item_key as item_key, sum(mu.qty_used)::integer as used_total
    from public.material_usage mu
    where mu.company_id = v_company_id
      and mu.project_id = p_project_id
    group by mu.item_key
  ),
  keys as (
    select r.item_key as item_key from req r
    union
    select u.item_key as item_key from used u
    union
    select ii.item_key as item_key
    from public.inventory_items ii
    where ii.company_id = v_company_id
      and ii.is_active = true
  )
  select
    k.item_key as item_key,
    coalesce(ii.name, initcap(replace(k.item_key, '_', ' '))) as item_name,
    coalesce(ii.unit, 'ea') as unit,
    coalesce(r.expected_total, 0) as expected_total,
    coalesce(u.used_total, 0) as used_total,
    coalesce(r.expected_total, 0) - coalesce(u.used_total, 0) as remaining,
    coalesce(st.on_hand, 0) as on_hand,
    coalesce(ii.reorder_point, 0) as reorder_point
  from keys k
  left join req r on r.item_key = k.item_key
  left join used u on u.item_key = k.item_key
  left join public.inventory_items ii
    on ii.company_id = v_company_id
   and ii.item_key = k.item_key
  left join public.inventory_stock st
    on st.company_id = v_company_id
   and st.item_id = ii.id
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
    select mr.item_key as item_key, sum(mr.qty_required)::integer as expected_qty
    from public.material_requirements mr
    where mr.company_id = v_company_id
      and mr.project_id = p_project_id
      and mr.feature_id = v_feature_id
    group by mr.item_key
  ),
  used as (
    select mu.item_key as item_key, sum(mu.qty_used)::integer as used_qty
    from public.material_usage mu
    where mu.company_id = v_company_id
      and mu.project_id = p_project_id
      and mu.feature_id = v_feature_id
    group by mu.item_key
  ),
  keys as (
    select r.item_key as item_key from req r
    union
    select u.item_key as item_key from used u
  )
  select
    k.item_key as item_key,
    coalesce(ii.name, initcap(replace(k.item_key, '_', ' '))) as item_name,
    coalesce(ii.unit, 'ea') as unit,
    coalesce(r.expected_qty, 0) as expected_qty,
    coalesce(u.used_qty, 0) as used_qty
  from keys k
  left join req r on r.item_key = k.item_key
  left join used u on u.item_key = k.item_key
  left join public.inventory_items ii
    on ii.company_id = v_company_id
   and ii.item_key = k.item_key
  order by item_name;
end;
$$;
