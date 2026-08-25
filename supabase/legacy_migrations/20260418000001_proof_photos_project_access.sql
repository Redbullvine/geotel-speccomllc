-- Allow photo storage for any project the signed-in user can access.

alter table if exists public.site_media enable row level security;

drop policy if exists "site_media_select_org" on public.site_media;
drop policy if exists "site_media_insert_org" on public.site_media;
drop policy if exists "site_media_delete_owner_admin_support" on public.site_media;

create policy "site_media_select_project_access"
on public.site_media for select
to authenticated
using (
  exists (
    select 1
    from public.sites s
    where s.id = site_media.site_id
      and (
        (s.project_id is not null and public.has_project_access(s.project_id))
        or (
          s.project_id is null
          and exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and upper(coalesce(p.role, '')) in ('ROOT','OWNER','ADMIN','PROJECT_MANAGER','SUPPORT','PRIME')
          )
        )
      )
  )
);

create policy "site_media_insert_project_access"
on public.site_media for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.sites s
    where s.id = site_media.site_id
      and (
        (s.project_id is not null and public.has_project_access(s.project_id))
        or (
          s.project_id is null
          and exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and upper(coalesce(p.role, '')) in ('ROOT','OWNER','ADMIN','PROJECT_MANAGER','SUPPORT','PRIME')
          )
        )
      )
  )
);

create policy "site_media_delete_project_access"
on public.site_media for delete
to authenticated
using (
  exists (
    select 1
    from public.sites s
    where s.id = site_media.site_id
      and (
        (s.project_id is not null and public.has_project_access(s.project_id))
        or (
          s.project_id is null
          and exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and upper(coalesce(p.role, '')) in ('ROOT','OWNER','ADMIN','PROJECT_MANAGER','SUPPORT','PRIME')
          )
        )
      )
  )
  and (
    site_media.created_by = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and upper(coalesce(p.role, '')) in ('ROOT','OWNER','ADMIN','PROJECT_MANAGER','SUPPORT','PRIME')
    )
  )
);

insert into storage.buckets (id, name, public)
values ('proof-photos', 'proof-photos', false)
on conflict (id) do nothing;

drop policy if exists "proof_photos_select_authenticated" on storage.objects;
create policy "proof_photos_select_authenticated"
on storage.objects for select
to authenticated
using (bucket_id = 'proof-photos');

drop policy if exists "proof_photos_insert_authenticated" on storage.objects;
create policy "proof_photos_insert_authenticated"
on storage.objects for insert
to authenticated
with check (bucket_id = 'proof-photos');

drop policy if exists "proof_photos_update_owner" on storage.objects;
create policy "proof_photos_update_owner"
on storage.objects for update
to authenticated
using (bucket_id = 'proof-photos' and owner = auth.uid())
with check (bucket_id = 'proof-photos' and owner = auth.uid());

drop policy if exists "proof_photos_delete_owner" on storage.objects;
create policy "proof_photos_delete_owner"
on storage.objects for delete
to authenticated
using (bucket_id = 'proof-photos' and owner = auth.uid());

notify pgrst, 'reload schema';
