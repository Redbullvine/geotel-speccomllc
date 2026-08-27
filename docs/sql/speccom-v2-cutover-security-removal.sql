-- SPEC COM V2 CUTOVER SECURITY REMOVAL PLAN — DO NOT APPLY YET
--
-- Preconditions:
--   1. Every listed table has an ownership/backfill report.
--   2. The V2 BFF has replaced every worker-facing direct Supabase call.
--   3. V2 Storage object migration and adversarial staging tests have passed.
--   4. A current production backup and rollback plan are verified.
--
-- This deliberately revokes browser access to V1 project data. It is a cutover
-- operation, not part of the additive foundation migration.

do $$
declare
  target_table text;
  policy record;
begin
  foreach target_table in array array[
    'projects', 'sites', 'site_codes', 'site_media', 'field_photos', 'nodes',
    'splice_locations', 'splice_location_photos', 'project_kmz_snapshots',
    'redline_markers', 'work_orders', 'work_order_events',
    'daily_progress_reports', 'technician_timesheets', 'technician_time_events',
    'field_day_sessions', 'field_day_events', 'field_location_pings',
    'field_work_logs', 'usage_events', 'proof_uploads', 'invoices',
    'invoice_items', 'invoice_files', 'material_requirements', 'material_usage',
    'inventory_stock', 'alert_events'
  ] loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('alter table public.%I enable row level security', target_table);
      execute format('revoke all on table public.%I from anon, authenticated, public', target_table);
      -- Existing V1 SELECT policies may remain in the catalog, but become
      -- unreachable after grants are revoked. Remove only named broad policies
      -- that are known to permit enumeration or all-authenticated reads.
      for policy in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = target_table
          and cmd in ('SELECT', 'ALL')
          and (
            policyname in ('public_read', 'projects_select_all_authenticated')
            or policyname like '%_read_authenticated'
            or policyname like '%_select_authenticated'
          )
      loop
        execute format('drop policy if exists %I on public.%I', policy.policyname, target_table);
      end loop;
    end if;
  end loop;
end $$;

-- Apply the following template ONLY after each table has an explicit,
-- non-null project_id and its backfill report is approved. It intentionally
-- grants no legacy Supabase Auth session access: V2's BFF sends a server-minted
-- asymmetric JWT whose `access_kind`, `project_session_id`, and `project_id`
-- claims are checked again by public.v2_authorized_project_id().
--
-- alter table public.<project_owned_table> enable row level security;
-- revoke all on public.<project_owned_table> from anon, authenticated, public;
-- grant select, insert, update, delete on public.<project_owned_table> to authenticated;
-- create policy "v2_project_select" on public.<project_owned_table>
--   for select to authenticated using (project_id = (select public.v2_authorized_project_id()));
-- create policy "v2_project_insert" on public.<project_owned_table>
--   for insert to authenticated with check (project_id = (select public.v2_authorized_project_id()));
-- create policy "v2_project_update" on public.<project_owned_table>
--   for update to authenticated using (project_id = (select public.v2_authorized_project_id()))
--   with check (project_id = (select public.v2_authorized_project_id()));
-- create policy "v2_project_delete" on public.<project_owned_table>
--   for delete to authenticated using (project_id = (select public.v2_authorized_project_id()));

-- Public field/proof images are never a V2 access mechanism. Existing objects
-- remain intact; the separate object-copy/backfill job moves them to
-- projects/<project-id>/... before their original references are retired.
update storage.buckets
set public = false
where id in ('field-photos', 'proof-photos');

drop policy if exists "field_photos_public_read" on storage.objects;
drop policy if exists "proof_and_field_photos_public_read" on storage.objects;
drop policy if exists "proof_photos_select_authenticated" on storage.objects;
revoke all on table storage.objects from anon, authenticated, public;

-- No storage.objects browser policy is created here. V2 uploads/downloads are
-- authorized by the BFF after cookie-session validation and use server-created,
-- short-lived signed URLs only for the session's derived project path.
notify pgrst, 'reload schema';
