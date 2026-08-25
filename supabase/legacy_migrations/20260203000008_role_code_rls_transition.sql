-- Transition RLS to accept role_code (with legacy fallback)
create or replace function public.effective_role_code(p_role_code text, p_role app_role)
returns text
language sql
stable
as $$
  select coalesce(p_role_code, public.role_code_from_legacy(p_role));
$$;

create or replace function public.role_code_in(p_role_code text, p_role app_role, allowed text[])
returns boolean
language sql
stable
as $$
  select public.effective_role_code(p_role_code, p_role) = any(allowed);
$$;

create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN'])
  );
$$;

create or replace function public.is_prime_or_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
  );
$$;

create or replace function public.is_admin_or_owner()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN'])
  );
$$;

-- Splice location deletes (Admin only)
drop policy if exists "splice_locations_delete_owner" on public.splice_locations;
create policy "splice_locations_delete_owner"
on public.splice_locations for delete
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN'])
  )
);

drop policy if exists "splice_location_photos_delete_owner" on public.splice_location_photos;
create policy "splice_location_photos_delete_owner"
on public.splice_location_photos for delete
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN'])
  )
);

-- User locations admin read
drop policy if exists "user_locations_admin_read_all" on public.user_locations;
create policy "user_locations_admin_read_all"
on public.user_locations for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN'])
  )
);

-- Project members write/update (Admin / Project Manager)
drop policy if exists "project_members_write_owner_prime" on public.project_members;
create policy "project_members_write_owner_prime"
on public.project_members for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
  )
  and public.is_demo_user() = false
);

drop policy if exists "project_members_update_owner_prime" on public.project_members;
create policy "project_members_update_owner_prime"
on public.project_members for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
  )
  and public.is_demo_user() = false
);

-- Technician admin policies
drop policy if exists "technician_timesheets_select_admin" on public.technician_timesheets;
create policy "technician_timesheets_select_admin"
on public.technician_timesheets for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
  )
  and exists (
    select 1 from public.project_members pm
    where pm.project_id = project_id and pm.user_id = auth.uid()
      and public.role_code_in(pm.role_code, pm.role, array['ADMIN','PROJECT_MANAGER'])
  )
);

drop policy if exists "technician_time_events_select_admin" on public.technician_time_events;
create policy "technician_time_events_select_admin"
on public.technician_time_events for select
to authenticated
using (
  exists (
    select 1
    from public.technician_timesheets t
    join public.project_members pm on pm.project_id = t.project_id and pm.user_id = auth.uid()
    join public.profiles p on p.id = auth.uid()
    where t.id = timesheet_id
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
      and public.role_code_in(pm.role_code, pm.role, array['ADMIN','PROJECT_MANAGER'])
  )
);

-- Work order admin policies
drop policy if exists "work_orders_select_admin" on public.work_orders;
create policy "work_orders_select_admin"
on public.work_orders for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
  )
  and exists (
    select 1 from public.project_members pm
    where pm.project_id = project_id and pm.user_id = auth.uid()
      and public.role_code_in(pm.role_code, pm.role, array['ADMIN','PROJECT_MANAGER'])
  )
);

drop policy if exists "work_orders_write_admin" on public.work_orders;
create policy "work_orders_write_admin"
on public.work_orders for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
  )
  and exists (
    select 1 from public.project_members pm
    where pm.project_id = project_id and pm.user_id = auth.uid()
      and public.role_code_in(pm.role_code, pm.role, array['ADMIN','PROJECT_MANAGER'])
  )
);

drop policy if exists "work_orders_update_admin" on public.work_orders;
create policy "work_orders_update_admin"
on public.work_orders for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
  )
  and exists (
    select 1 from public.project_members pm
    where pm.project_id = project_id and pm.user_id = auth.uid()
      and public.role_code_in(pm.role_code, pm.role, array['ADMIN','PROJECT_MANAGER'])
  )
);

drop policy if exists "work_orders_delete_admin" on public.work_orders;
create policy "work_orders_delete_admin"
on public.work_orders for delete
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
  )
  and exists (
    select 1 from public.project_members pm
    where pm.project_id = project_id and pm.user_id = auth.uid()
      and public.role_code_in(pm.role_code, pm.role, array['ADMIN','PROJECT_MANAGER'])
  )
);

drop policy if exists "work_order_events_select_admin" on public.work_order_events;
create policy "work_order_events_select_admin"
on public.work_order_events for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
  )
  and exists (
    select 1 from public.project_members pm
    where pm.project_id = project_id and pm.user_id = auth.uid()
      and public.role_code_in(pm.role_code, pm.role, array['ADMIN','PROJECT_MANAGER'])
  )
);

drop policy if exists "work_order_events_insert_admin" on public.work_order_events;
create policy "work_order_events_insert_admin"
on public.work_order_events for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
  )
  and exists (
    select 1 from public.project_members pm
    where pm.project_id = project_id and pm.user_id = auth.uid()
      and public.role_code_in(pm.role_code, pm.role, array['ADMIN','PROJECT_MANAGER'])
  )
);

-- Demo invoice role gates (transition-friendly)
drop policy if exists "invoices_read_job_roles" on public.invoices;
drop policy if exists "invoices_write_job_roles" on public.invoices;
drop policy if exists "invoices_update_job_roles" on public.invoices;

create policy "invoices_read_job_roles"
on public.invoices for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER','USER_LEVEL_I','USER_LEVEL_II','SUPPORT'])
  )
  and (
    public.is_demo_user() = false
    or (project_id is not null and public.is_demo_project(project_id))
  )
);

create policy "invoices_write_job_roles"
on public.invoices for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER','USER_LEVEL_I','USER_LEVEL_II','SUPPORT'])
  )
  and public.is_demo_user() = false
);

create policy "invoices_update_job_roles"
on public.invoices for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER','USER_LEVEL_I','USER_LEVEL_II','SUPPORT'])
  )
  and public.is_demo_user() = false
);

drop policy if exists "invoice_items_write_job_roles" on public.invoice_items;
drop policy if exists "invoice_items_update_job_roles" on public.invoice_items;

create policy "invoice_items_write_job_roles"
on public.invoice_items for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER','USER_LEVEL_I','USER_LEVEL_II','SUPPORT'])
  )
  and public.is_demo_user() = false
);

create policy "invoice_items_update_job_roles"
on public.invoice_items for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER','USER_LEVEL_I','USER_LEVEL_II','SUPPORT'])
  )
  and public.is_demo_user() = false
);

drop policy if exists "sub_invoices_read_sub_prime_owner" on public.sub_invoices;
drop policy if exists "sub_invoices_write_sub_owner" on public.sub_invoices;
drop policy if exists "sub_invoices_update_sub_prime_owner" on public.sub_invoices;

create policy "sub_invoices_read_sub_prime_owner"
on public.sub_invoices for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER','USER_LEVEL_II'])
  )
  and (
    public.is_demo_user() = false
    or public.is_demo_project(public.project_id_for_node(node_id))
  )
);

create policy "sub_invoices_write_sub_owner"
on public.sub_invoices for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','USER_LEVEL_II'])
  )
  and public.is_demo_user() = false
);

create policy "sub_invoices_update_sub_prime_owner"
on public.sub_invoices for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER','USER_LEVEL_II'])
  )
  and public.is_demo_user() = false
);

drop policy if exists "prime_invoices_read_prime_tds_owner" on public.prime_invoices;
drop policy if exists "prime_invoices_write_prime_owner" on public.prime_invoices;
drop policy if exists "prime_invoices_update_prime_tds_owner" on public.prime_invoices;

create policy "prime_invoices_read_prime_tds_owner"
on public.prime_invoices for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER','SUPPORT'])
  )
  and (
    public.is_demo_user() = false
    or public.is_demo_project(public.project_id_for_node(node_id))
  )
);

create policy "prime_invoices_write_prime_owner"
on public.prime_invoices for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER'])
  )
  and public.is_demo_user() = false
);

create policy "prime_invoices_update_prime_tds_owner"
on public.prime_invoices for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and public.role_code_in(p.role_code, p.role, array['ADMIN','PROJECT_MANAGER','SUPPORT'])
  )
  and public.is_demo_user() = false
);

notify pgrst, 'reload schema';
