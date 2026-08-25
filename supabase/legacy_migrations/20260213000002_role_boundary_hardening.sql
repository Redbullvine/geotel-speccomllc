-- Enforce platform/global roles (ROOT, SUPPORT) while keeping OWNER/ADMIN scoped to org.

-- Billing: pricing agreements
alter table public.pricing_agreements enable row level security;

drop policy if exists "pricing_agreements_read_issuer" on public.pricing_agreements;
create policy "pricing_agreements_read_issuer"
on public.pricing_agreements for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.org_id = from_company_id
        or public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
      )
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
      and (
        public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
        or (
          p.org_id = from_company_id
          and public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER')
        )
      )
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
      and (
        public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
        or (
          p.org_id = from_company_id
          and public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER')
        )
      )
  )
);

-- Billing: invoices
alter table public.invoices enable row level security;

drop policy if exists "invoices_read_org" on public.invoices;
create policy "invoices_read_org"
on public.invoices for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.org_id = billed_by_org_id
        or p.org_id = billed_to_org_id
        or public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
      )
  )
);

drop policy if exists "invoices_write_issuer" on public.invoices;
create policy "invoices_write_issuer"
on public.invoices for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
        or (
          p.org_id = billed_by_org_id
          and public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER')
        )
      )
  )
);

drop policy if exists "invoices_update_issuer" on public.invoices;
create policy "invoices_update_issuer"
on public.invoices for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
        or (
          p.org_id = billed_by_org_id
          and public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER')
        )
      )
  )
);

-- Billing: invoice items
alter table public.invoice_items enable row level security;

drop policy if exists "invoice_items_read_by_invoice_org" on public.invoice_items;
create policy "invoice_items_read_by_invoice_org"
on public.invoice_items for select
to authenticated
using (
  exists (
    select 1
    from public.invoices i
    join public.profiles p on p.id = auth.uid()
    where i.id = invoice_id
      and (
        p.org_id = i.billed_by_org_id
        or p.org_id = i.billed_to_org_id
        or public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
      )
  )
);

drop policy if exists "invoice_items_write_by_issuer" on public.invoice_items;
create policy "invoice_items_write_by_issuer"
on public.invoice_items for insert
to authenticated
with check (
  exists (
    select 1
    from public.invoices i
    join public.profiles p on p.id = auth.uid()
    where i.id = invoice_id
      and (
        public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
        or (
          p.org_id = i.billed_by_org_id
          and public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER')
        )
      )
  )
);

drop policy if exists "invoice_items_update_by_issuer" on public.invoice_items;
create policy "invoice_items_update_by_issuer"
on public.invoice_items for update
to authenticated
using (
  exists (
    select 1
    from public.invoices i
    join public.profiles p on p.id = auth.uid()
    where i.id = invoice_id
      and (
        public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
        or (
          p.org_id = i.billed_by_org_id
          and public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER')
        )
      )
  )
);

-- Tiered invoice generation: remove OWNER global bypass; keep ROOT/SUPPORT global.
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
  v_role_code text;
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

  select public.effective_role_code(p.role_code, p.role), p.org_id
    into v_role_code, v_org_id
  from public.profiles p
  where p.id = v_user_id;

  if v_role_code is null or v_role_code not in ('ROOT','SUPPORT','OWNER','ADMIN','PROJECT_MANAGER') then
    raise exception 'Not authorized';
  end if;

  if v_role_code not in ('ROOT','SUPPORT') and v_org_id <> p_from_org_id then
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

-- Messages: only platform/global roles can read/write truly global (project_id is null) messages.
do $$
begin
  if to_regclass('public.messages') is not null then
    drop policy if exists "messages_select_project_members" on public.messages;
    create policy "messages_select_project_members"
    on public.messages for select
    to authenticated
    using (
      sender_id = auth.uid()
      or recipient_id = auth.uid()
      or (
        project_id is null
        and exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
        )
      )
      or exists (
        select 1 from public.project_members pm
        where pm.project_id = project_id and pm.user_id = auth.uid()
      )
    );

    drop policy if exists "messages_insert_project_members" on public.messages;
    create policy "messages_insert_project_members"
    on public.messages for insert
    to authenticated
    with check (
      sender_id = auth.uid()
      and (
        (
          project_id is null
          and exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
          )
        )
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = project_id and pm.user_id = auth.uid()
        )
      )
    );
  else
    raise notice 'public.messages not found; skipping message policy hardening';
  end if;
end $$;

-- Project grant RPC: allow ROOT or SUPPORT to grant access globally.
create or replace function public.fn_grant_project_access(
  p_project_id uuid,
  p_user_identifier text,
  p_role_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_code text;
  v_target_user_id uuid;
  v_role app_role;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select public.effective_role_code(p.role_code, p.role)
    into v_role_code
  from public.profiles p
  where p.id = v_user_id;

  if v_role_code is null or v_role_code not in ('ROOT','SUPPORT') then
    raise exception 'Not authorized';
  end if;

  if p_project_id is null then
    raise exception 'Project required';
  end if;

  if p_user_identifier is null or length(trim(p_user_identifier)) = 0 then
    raise exception 'User required';
  end if;

  begin
    v_target_user_id := p_user_identifier::uuid;
  exception when invalid_text_representation then
    select u.id
      into v_target_user_id
    from auth.users u
    where lower(u.email) = lower(trim(p_user_identifier));
  end;

  if v_target_user_id is null then
    raise exception 'User not found';
  end if;

  v_role_code := upper(trim(coalesce(p_role_code, 'USER_LEVEL_1')));
  if v_role_code in ('USER1') then v_role_code := 'USER_LEVEL_1'; end if;
  if v_role_code in ('USER2') then v_role_code := 'USER_LEVEL_2'; end if;
  if v_role_code in ('USER_LEVEL_I') then v_role_code := 'USER_LEVEL_1'; end if;
  if v_role_code in ('USER_LEVEL_II') then v_role_code := 'USER_LEVEL_2'; end if;

  if v_role_code not in ('OWNER','ADMIN','PROJECT_MANAGER','USER_LEVEL_1','USER_LEVEL_2','SUPPORT') then
    raise exception 'Invalid role';
  end if;

  v_role := case v_role_code
    when 'OWNER' then 'OWNER'::app_role
    when 'ADMIN' then 'ADMIN'::app_role
    when 'PROJECT_MANAGER' then 'PROJECT_MANAGER'::app_role
    when 'SUPPORT' then 'SUPPORT'::app_role
    when 'USER_LEVEL_1' then 'USER_LEVEL_1'::app_role
    when 'USER_LEVEL_2' then 'USER_LEVEL_2'::app_role
    else 'USER_LEVEL_1'::app_role
  end;

  insert into public.project_members (project_id, user_id, role, role_code)
  values (p_project_id, v_target_user_id, v_role, v_role_code)
  on conflict (project_id, user_id)
  do update set role = excluded.role, role_code = excluded.role_code;

  return jsonb_build_object(
    'project_id', p_project_id,
    'user_id', v_target_user_id,
    'role_code', v_role_code
  );
end;
$$;

revoke all on function public.fn_grant_project_access(uuid, text, text) from public;
grant execute on function public.fn_grant_project_access(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
