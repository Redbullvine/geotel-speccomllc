-- Intentionally make project/map/photo rows public-readable.
-- This removes project visibility and Ruidoso photo visibility as sources of
-- field-user lockouts. Write permissions are not opened here.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'projects',
    'sites',
    'site_codes',
    'site_media',
    'field_photos',
    'nodes',
    'splice_locations',
    'splice_location_photos'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('grant select on table public.%I to anon, authenticated', table_name);
      execute format('drop policy if exists "public_read" on public.%I', table_name);
      execute format(
        'create policy "public_read" on public.%I for select to public using (true)',
        table_name
      );
    end if;
  end loop;

  if to_regclass('storage.objects') is not null then
    grant select on table storage.objects to anon, authenticated;
    drop policy if exists "proof_and_field_photos_public_read" on storage.objects;
    create policy "proof_and_field_photos_public_read"
    on storage.objects
    for select
    to public
    using (bucket_id in ('proof-photos', 'field-photos'));
  end if;
end $$;

notify pgrst, 'reload schema';
