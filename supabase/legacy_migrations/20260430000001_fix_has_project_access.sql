-- Replace has_project_access() with an implementation that no longer depends
-- on the dropped is_owner() / effective_role_code() functions.
-- Those were removed in 20260315000001_reset_roles_open_access.sql, but
-- has_project_access() was defined directly in the DB and still called them,
-- causing all site_media queries to fail with:
--   "function public.is_owner() does not exist"

create or replace function public.has_project_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects pr
    join public.profiles p on p.id = auth.uid()
    where pr.id = p_project_id
      and (
        upper(coalesce(p.role, '')) = 'ROOT'
        or p.org_id = pr.org_id
        or exists (
          select 1
          from public.project_members pm
          where pm.project_id = pr.id
            and pm.user_id = auth.uid()
        )
      )
  );
$$;

notify pgrst, 'reload schema';
