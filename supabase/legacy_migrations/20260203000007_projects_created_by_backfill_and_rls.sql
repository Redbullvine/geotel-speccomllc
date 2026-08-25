-- Ensure created_by default and backfill legacy rows when possible
alter table public.projects
  alter column created_by set default auth.uid();

-- Backfill created_by using org owners/admins when available
update public.projects p
set created_by = coalesce(
  p.created_by,
  (
    select pr.id
    from public.profiles pr
    where pr.org_id = p.org_id
      and pr.role in ('OWNER','ADMIN')
    order by pr.created_at asc
    limit 1
  )
)
where p.created_by is null;

-- RLS: allow creator to select their own projects even if org/membership is missing
drop policy if exists "projects_select_same_org" on public.projects;
create policy "projects_select_same_org"
on public.projects
for select
to authenticated
using (
  created_by = auth.uid()
  or org_id = (select org_id from public.profiles where id = auth.uid())
);
