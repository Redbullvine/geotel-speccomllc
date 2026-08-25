-- Allow every signed-in user to see every project in the project picker.
-- This adds a permissive read policy for environments where projects RLS is
-- enabled, without changing project create/update/delete permissions.

do $$
begin
  if to_regclass('public.projects') is not null then
    drop policy if exists "projects_select_all_authenticated" on public.projects;

    create policy "projects_select_all_authenticated"
    on public.projects
    for select
    to authenticated
    using (auth.uid() is not null);
  end if;
end $$;

notify pgrst, 'reload schema';
