-- DISPOSABLE V2 ISOLATION TEST ENVIRONMENT ONLY. Do not apply to shared,
-- staging, or production databases. Seed data is performed by the integration
-- runner after this schema has been applied to a dedicated clone.

create table if not exists public.v2_test_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  kind text not null default 'task',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v2_test_records_project_idx on public.v2_test_records(project_id);

create table if not exists public.v2_test_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  object_path text not null unique,
  label text not null,
  created_at timestamptz not null default now(),
  check (object_path like 'projects/' || project_id::text || '/%')
);
create index if not exists v2_test_assets_project_idx on public.v2_test_assets(project_id);

alter table public.v2_test_records enable row level security;
alter table public.v2_test_assets enable row level security;
revoke all on public.v2_test_records, public.v2_test_assets from anon, authenticated, public;
grant select, insert, update, delete on public.v2_test_records, public.v2_test_assets to authenticated;

create policy "v2_test_records_select" on public.v2_test_records for select to authenticated
  using (project_id = (select public.v2_authorized_project_id()));
create policy "v2_test_records_insert" on public.v2_test_records for insert to authenticated
  with check (project_id = (select public.v2_authorized_project_id()));
create policy "v2_test_records_update" on public.v2_test_records for update to authenticated
  using (project_id = (select public.v2_authorized_project_id()))
  with check (project_id = (select public.v2_authorized_project_id()));
create policy "v2_test_records_delete" on public.v2_test_records for delete to authenticated
  using (project_id = (select public.v2_authorized_project_id()));
create policy "v2_test_assets_select" on public.v2_test_assets for select to authenticated
  using (project_id = (select public.v2_authorized_project_id()));
create policy "v2_test_assets_insert" on public.v2_test_assets for insert to authenticated
  with check (project_id = (select public.v2_authorized_project_id()));
create policy "v2_test_assets_update" on public.v2_test_assets for update to authenticated
  using (project_id = (select public.v2_authorized_project_id()))
  with check (project_id = (select public.v2_authorized_project_id()));
create policy "v2_test_assets_delete" on public.v2_test_assets for delete to authenticated
  using (project_id = (select public.v2_authorized_project_id()));

insert into storage.buckets (id, name, public)
values ('v2-isolation-test', 'v2-isolation-test', false)
on conflict (id) do update set public = false;

revoke all on storage.objects from anon, public;
grant select, insert, update, delete on storage.objects to authenticated;
create policy "v2_isolation_test_storage_select" on storage.objects for select to authenticated
  using (bucket_id = 'v2-isolation-test'
    and (storage.foldername(name))[1] = 'projects'
    and (storage.foldername(name))[2] = (select public.v2_authorized_project_id())::text);
create policy "v2_isolation_test_storage_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'v2-isolation-test'
    and (storage.foldername(name))[1] = 'projects'
    and (storage.foldername(name))[2] = (select public.v2_authorized_project_id())::text);
create policy "v2_isolation_test_storage_update" on storage.objects for update to authenticated
  using (bucket_id = 'v2-isolation-test'
    and (storage.foldername(name))[1] = 'projects'
    and (storage.foldername(name))[2] = (select public.v2_authorized_project_id())::text)
  with check (bucket_id = 'v2-isolation-test'
    and (storage.foldername(name))[1] = 'projects'
    and (storage.foldername(name))[2] = (select public.v2_authorized_project_id())::text);
create policy "v2_isolation_test_storage_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'v2-isolation-test'
    and (storage.foldername(name))[1] = 'projects'
    and (storage.foldername(name))[2] = (select public.v2_authorized_project_id())::text);

notify pgrst, 'reload schema';
