create table if not exists public.pricing_agreements (
  id uuid primary key default gen_random_uuid(),
  from_company_id uuid not null references public.orgs(id) on delete cascade,
  to_company_id uuid not null references public.orgs(id) on delete cascade,
  billing_code text not null,
  unit_price numeric(10,2) not null,
  currency text not null default 'USD',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists pricing_agreements_unique
  on public.pricing_agreements(from_company_id, to_company_id, billing_code);

alter table public.pricing_agreements enable row level security;

drop policy if exists "pricing_agreements_read_issuer" on public.pricing_agreements;
create policy "pricing_agreements_read_issuer"
on public.pricing_agreements for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.org_id = from_company_id or p.role = 'OWNER')
  )
);

drop policy if exists "pricing_agreements_write_issuer" on public.pricing_agreements;
create policy "pricing_agreements_write_issuer"
on public.pricing_agreements for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.org_id = from_company_id
      and p.role in ('OWNER','ADMIN','PROJECT_MANAGER')
  )
);

drop policy if exists "pricing_agreements_update_issuer" on public.pricing_agreements;
create policy "pricing_agreements_update_issuer"
on public.pricing_agreements for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.org_id = from_company_id
      and p.role in ('OWNER','ADMIN','PROJECT_MANAGER')
  )
);

alter table public.invoices enable row level security;

drop policy if exists "invoices_read_job_roles" on public.invoices;
drop policy if exists "invoices_write_job_roles" on public.invoices;
drop policy if exists "invoices_update_job_roles" on public.invoices;
drop policy if exists "invoices_read_by_org" on public.invoices;
drop policy if exists "invoices_write_by_org" on public.invoices;
drop policy if exists "invoices_update_by_org" on public.invoices;

create policy "invoices_read_org"
on public.invoices for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.org_id = billed_by_org_id or p.org_id = billed_to_org_id or p.role = 'OWNER')
  )
);

create policy "invoices_write_issuer"
on public.invoices for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.org_id = billed_by_org_id
      and p.role in ('OWNER','ADMIN','PROJECT_MANAGER')
  )
);

create policy "invoices_update_issuer"
on public.invoices for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.org_id = billed_by_org_id
      and p.role in ('OWNER','ADMIN','PROJECT_MANAGER')
  )
);

alter table public.invoice_items enable row level security;

drop policy if exists "invoice_items_read_all_authed" on public.invoice_items;
drop policy if exists "invoice_items_write_job_roles" on public.invoice_items;
drop policy if exists "invoice_items_update_job_roles" on public.invoice_items;
drop policy if exists "invoice_items_read_by_invoice" on public.invoice_items;
drop policy if exists "invoice_items_write_by_biller" on public.invoice_items;
drop policy if exists "invoice_items_update_by_biller" on public.invoice_items;

create policy "invoice_items_read_by_invoice_org"
on public.invoice_items for select
to authenticated
using (
  exists (
    select 1
    from public.invoices i
    join public.profiles p on p.id = auth.uid()
    where i.id = invoice_id
      and (p.org_id = i.billed_by_org_id or p.org_id = i.billed_to_org_id or p.role = 'OWNER')
  )
);

create policy "invoice_items_write_by_issuer"
on public.invoice_items for insert
to authenticated
with check (
  exists (
    select 1
    from public.invoices i
    join public.profiles p on p.id = auth.uid()
    where i.id = invoice_id
      and p.org_id = i.billed_by_org_id
      and p.role in ('OWNER','ADMIN','PROJECT_MANAGER')
  )
);

create policy "invoice_items_update_by_issuer"
on public.invoice_items for update
to authenticated
using (
  exists (
    select 1
    from public.invoices i
    join public.profiles p on p.id = auth.uid()
    where i.id = invoice_id
      and p.org_id = i.billed_by_org_id
      and p.role in ('OWNER','ADMIN','PROJECT_MANAGER')
  )
);

create or replace function public.fn_generate_tiered_invoices(
  p_project_id uuid,
  p_from_org_id uuid,
  p_to_org_id uuid,
  p_site_ids uuid[] default null,
  p_allow_duplicate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_org_id uuid;
  v_has_status boolean := false;
  v_site record;
  v_entry record;
  v_invoice_id uuid;
  v_created int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_invoices jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_price numeric := null;
  v_item_count int := 0;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select p.role, p.org_id into v_role, v_org_id
  from public.profiles p
  where p.id = v_user_id;

  if v_role is null or v_role::text not in ('OWNER','ADMIN','PROJECT_MANAGER') then
    raise exception 'Not authorized';
  end if;

  if v_role::text <> 'OWNER' and v_org_id <> p_from_org_id then
    raise exception 'Not authorized for issuer org';
  end if;

  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sites'
      and column_name = 'status'
  ) into v_has_status;

  for v_site in
    select
      s.id,
      s.project_id,
      s.name,
      case when v_has_status then s.status else null end as status
    from public.sites s
    where s.project_id = p_project_id
      and (p_site_ids is null or s.id = any(p_site_ids))
  loop
    begin
      v_invoice_id := null;
      v_subtotal := 0;
      v_item_count := 0;

      if v_has_status and coalesce(upper(v_site.status::text), '') <> 'COMPLETE' then
        v_skipped := v_skipped + 1;
        v_errors := v_errors || jsonb_build_object('site_id', v_site.id, 'reason', 'Site not complete');
        continue;
      end if;

      if not p_allow_duplicate then
        if exists (
          select 1 from public.invoices i
          where i.site_id = v_site.id
            and i.billed_by_org_id = p_from_org_id
            and i.billed_to_org_id = p_to_org_id
            and coalesce(lower(i.status), '') <> 'void'
        ) then
          v_skipped := v_skipped + 1;
          v_errors := v_errors || jsonb_build_object('site_id', v_site.id, 'reason', 'Invoice already exists');
          continue;
        end if;
      end if;

      for v_entry in
        select e.description, e.quantity
        from public.site_entries e
        where e.site_id = v_site.id
      loop
        if v_entry.description is null or trim(v_entry.description) = '' then
          continue;
        end if;
        if v_entry.quantity is null or v_entry.quantity <= 0 then
          continue;
        end if;

        select pa.unit_price into v_price
        from public.pricing_agreements pa
        where pa.from_company_id = p_from_org_id
          and pa.to_company_id = p_to_org_id
          and upper(pa.billing_code) = upper(trim(v_entry.description))
          and pa.active = true
        limit 1;

        if v_price is null then
          v_errors := v_errors || jsonb_build_object(
            'site_id', v_site.id,
            'reason', 'Missing pricing for ' || trim(v_entry.description)
          );
          continue;
        end if;

        if v_invoice_id is null then
          insert into public.invoices (
            project_id,
            site_id,
            billed_by_org_id,
            billed_to_org_id,
            status,
            created_by,
            subtotal,
            tax,
            total,
            updated_at
          )
          values (
            p_project_id,
            v_site.id,
            p_from_org_id,
            p_to_org_id,
            'draft',
            v_user_id,
            0,
            0,
            0,
            now()
          )
          returning id into v_invoice_id;
        end if;

        insert into public.invoice_items (
          invoice_id,
          work_code_id,
          description,
          unit,
          qty,
          rate,
          sort_order
        )
        values (
          v_invoice_id,
          null,
          trim(v_entry.description),
          '',
          v_entry.quantity,
          v_price,
          v_item_count
        );

        v_subtotal := v_subtotal + (v_entry.quantity * v_price);
        v_item_count := v_item_count + 1;
      end loop;

      if v_invoice_id is null or v_item_count = 0 then
        if v_invoice_id is not null then
          delete from public.invoices where id = v_invoice_id;
          v_invoice_id := null;
        end if;
        v_skipped := v_skipped + 1;
        v_errors := v_errors || jsonb_build_object('site_id', v_site.id, 'reason', 'No billable items');
        continue;
      end if;

      v_total := v_subtotal;
      update public.invoices
      set subtotal = v_subtotal,
          tax = 0,
          total = v_total,
          updated_at = now()
      where id = v_invoice_id;

      v_created := v_created + 1;
      v_invoices := v_invoices || jsonb_build_object(
        'site_id', v_site.id,
        'invoice_id', v_invoice_id,
        'total', v_total,
        'item_count', v_item_count
      );
      v_invoice_id := null;
    exception when others then
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('site_id', v_site.id, 'reason', sqlerrm);
      if v_invoice_id is not null then
        delete from public.invoices where id = v_invoice_id;
        v_invoice_id := null;
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'skipped', v_skipped,
    'errors', v_errors,
    'invoices', v_invoices
  );
end;
$$;

revoke all on function public.fn_generate_tiered_invoices(uuid, uuid, uuid, uuid[], boolean) from public;
grant execute on function public.fn_generate_tiered_invoices(uuid, uuid, uuid, uuid[], boolean) to authenticated;
