-- Backfill project_members for projects with created_by but missing membership
do $$
begin
  if to_regclass('public.project_members') is not null then
    insert into public.project_members (project_id, user_id, role)
    select p.id, p.created_by, 'OWNER'
    from public.projects p
    where p.created_by is not null
      and not exists (
        select 1 from public.project_members pm
        where pm.project_id = p.id and pm.user_id = p.created_by
      );
  end if;
end $$;
