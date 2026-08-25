create or replace function public.fn_generate_site_invoices(
  p_project_id uuid,
  p_site_ids uuid[] default null,
  p_allow_duplicate boolean default false,
  p_rate_card_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_code text;
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
  v_rate numeric := null;
  v_work record;
  v_item_count int := 0;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select public.effective_role_code(p.role_code, p.role)
    into v_role_code
  from public.profiles p
  where p.id = v_user_id;

  if v_role_code is null or v_role_code not in ('OWNER','ADMIN','PROJECT_MANAGER','ROOT') then
    raise exception 'Not authorized';
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

        select id, code, description, unit, default_rate
        into v_work
        from public.work_codes
        where upper(code) = upper(trim(v_entry.description))
        limit 1;

        if v_work.id is null then
          v_errors := v_errors || jsonb_build_object(
            'site_id', v_site.id,
            'reason', 'Unknown work code: ' || trim(v_entry.description)
          );
          continue;
        end if;

        v_rate := null;
        if p_rate_card_id is not null then
          select rci.rate into v_rate
          from public.rate_card_items rci
          where rci.rate_card_id = p_rate_card_id
            and rci.work_code_id = v_work.id
          limit 1;
        end if;

        if v_rate is null then
          v_rate := coalesce(v_work.default_rate, 0);
        end if;

        if v_invoice_id is null then
          insert into public.invoices (
            project_id,
            site_id,
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
          v_work.id,
          coalesce(v_work.description, v_entry.description),
          coalesce(v_work.unit, ''),
          v_entry.quantity,
          v_rate,
          v_item_count
        );

        v_subtotal := v_subtotal + (v_entry.quantity * v_rate);
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

revoke all on function public.fn_generate_site_invoices(uuid, uuid[], boolean, uuid) from public;
grant execute on function public.fn_generate_site_invoices(uuid, uuid[], boolean, uuid) to authenticated;
