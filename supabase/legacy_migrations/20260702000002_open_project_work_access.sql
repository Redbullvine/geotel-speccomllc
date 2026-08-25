-- Project work access model:
-- every signed-in user can use field/work functions in every project.
-- Project ownership remains separate: creator/root still controls project
-- edit, grant-access, and deletion through can_control_project().

create or replace function public.has_project_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.projects pr
      where pr.id = p_project_id
    );
$$;

grant execute on function public.has_project_access(uuid) to authenticated;

create or replace function public.fn_material_has_project_access(p_project_id uuid, p_company_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.projects pr
      where pr.id = p_project_id
    );
$$;

grant execute on function public.fn_material_has_project_access(uuid, uuid) to authenticated;

do $$
begin
  if to_regclass('public.field_photos') is not null then
    alter table public.field_photos enable row level security;

    drop policy if exists "field_photos_select_by_project_org" on public.field_photos;
    drop policy if exists "field_photos_insert_by_project_org" on public.field_photos;
    drop policy if exists "field_photos_select_authenticated" on public.field_photos;
    drop policy if exists "field_photos_insert_authenticated" on public.field_photos;

    create policy "field_photos_select_authenticated"
    on public.field_photos
    for select
    to authenticated
    using (
      auth.uid() is not null
      and (
        field_photos.project_id is null
        or public.has_project_access(field_photos.project_id)
      )
    );

    create policy "field_photos_insert_authenticated"
    on public.field_photos
    for insert
    to authenticated
    with check (
      auth.uid() is not null
      and (
        field_photos.project_id is null
        or public.has_project_access(field_photos.project_id)
      )
    );

    grant select, insert on table public.field_photos to authenticated;
  end if;
end $$;

notify pgrst, 'reload schema';
