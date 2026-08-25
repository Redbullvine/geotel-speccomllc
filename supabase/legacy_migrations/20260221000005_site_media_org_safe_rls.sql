-- Site media ownership + org-safe RLS

alter table public.site_media
  add column if not exists created_by uuid references auth.users(id);

alter table public.site_media
  alter column created_by set default auth.uid();

update public.site_media sm
set created_by = coalesce(sm.created_by, s.created_by)
from public.sites s
where s.id = sm.site_id
  and sm.created_by is null;

create index if not exists site_media_created_by_idx on public.site_media(created_by);

alter table public.site_media enable row level security;

drop policy if exists "site_media_select_org" on public.site_media;
create policy "site_media_select_org"
on public.site_media for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    join public.sites s on s.id = site_media.site_id
    join public.projects pr on pr.id = s.project_id
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or pr.org_id = p.org_id
      )
  )
);

drop policy if exists "site_media_insert_org" on public.site_media;
create policy "site_media_insert_org"
on public.site_media for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.profiles p
    join public.sites s on s.id = site_media.site_id
    join public.projects pr on pr.id = s.project_id
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or pr.org_id = p.org_id
      )
  )
);

drop policy if exists "site_media_delete_owner_admin_support" on public.site_media;
create policy "site_media_delete_owner_admin_support"
on public.site_media for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    join public.sites s on s.id = site_media.site_id
    join public.projects pr on pr.id = s.project_id
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          pr.org_id = p.org_id
          and (
            site_media.created_by = auth.uid()
            or public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','SUPPORT')
          )
        )
      )
  )
);

notify pgrst, 'reload schema';