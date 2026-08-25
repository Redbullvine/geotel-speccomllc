insert into storage.buckets (id, name, public)
values ('field-photos', 'field-photos', true)
on conflict (id) do update
set public = true;

drop policy if exists "field_photos_public_read" on storage.objects;
create policy "field_photos_public_read"
on storage.objects
for select
to public
using (bucket_id = 'field-photos');

drop policy if exists "field_photos_auth_insert" on storage.objects;
create policy "field_photos_auth_insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'field-photos');
