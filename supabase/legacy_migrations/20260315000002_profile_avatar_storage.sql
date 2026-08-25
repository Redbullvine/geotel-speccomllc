-- Profile avatar support for dashboard header

alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-images',
  'profile-images',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_images_public_read" on storage.objects;
create policy "profile_images_public_read"
on storage.objects
for select
to public
using (bucket_id = 'profile-images');

drop policy if exists "profile_images_owner_insert" on storage.objects;
create policy "profile_images_owner_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "profile_images_owner_update" on storage.objects;
create policy "profile_images_owner_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-images'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'profile-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "profile_images_owner_delete" on storage.objects;
create policy "profile_images_owner_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);
