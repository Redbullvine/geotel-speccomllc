create extension if not exists pgcrypto;

create table if not exists public.field_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid null references public.projects(id) on delete set null,
  file_name text not null,
  mh_number text,
  image_url text not null,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);

create index if not exists field_photos_project_id_idx on public.field_photos(project_id);
create index if not exists field_photos_created_at_idx on public.field_photos(created_at desc);

alter table public.field_photos enable row level security;

drop policy if exists "field_photos_select_by_project_org" on public.field_photos;
create policy "field_photos_select_by_project_org"
on public.field_photos for select
to authenticated
using (
  auth.uid() is not null
  and (
    field_photos.project_id is null
    or exists (
      select 1
      from public.profiles p
      join public.projects pr on pr.id = field_photos.project_id
      where p.id = auth.uid()
        and (
          upper(coalesce(p.role, '')) = 'ROOT'
          or pr.org_id = p.org_id
        )
    )
  )
);

drop policy if exists "field_photos_insert_by_project_org" on public.field_photos;
create policy "field_photos_insert_by_project_org"
on public.field_photos for insert
to authenticated
with check (
  auth.uid() is not null
  and (
    field_photos.project_id is null
    or exists (
      select 1
      from public.profiles p
      join public.projects pr on pr.id = field_photos.project_id
      where p.id = auth.uid()
        and (
          upper(coalesce(p.role, '')) = 'ROOT'
          or pr.org_id = p.org_id
        )
    )
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'field-photos',
  'field-photos',
  true,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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

drop policy if exists "field_photos_auth_update" on storage.objects;
create policy "field_photos_auth_update"
on storage.objects
for update
to authenticated
using (bucket_id = 'field-photos')
with check (bucket_id = 'field-photos');

drop policy if exists "field_photos_auth_delete" on storage.objects;
create policy "field_photos_auth_delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'field-photos');

notify pgrst, 'reload schema';
