create table if not exists public.redline_markers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  site_id uuid null,
  project_id uuid null,
  location_id uuid null,
  sheet_ref text null,
  source_type text not null default 'sheet',
  source_page integer null,
  marker_x numeric not null,
  marker_y numeric not null,
  change_type text not null,
  title text null,
  old_value text null,
  new_value text null,
  notes text null,
  status text not null default 'open',
  photo_url text null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.redline_markers
  alter column created_by set default auth.uid();

alter table public.redline_markers
  drop constraint if exists redline_markers_status_check;

alter table public.redline_markers
  add constraint redline_markers_status_check
  check (status in ('open', 'resolved'));

create index if not exists redline_markers_project_id_idx on public.redline_markers(project_id);
create index if not exists redline_markers_location_id_idx on public.redline_markers(location_id);
create index if not exists redline_markers_sheet_ref_idx on public.redline_markers(sheet_ref);
create index if not exists redline_markers_status_idx on public.redline_markers(status);
create index if not exists redline_markers_change_type_idx on public.redline_markers(change_type);
create index if not exists redline_markers_created_by_idx on public.redline_markers(created_by);

create or replace function public.set_redline_markers_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_redline_markers_updated_at on public.redline_markers;
create trigger trg_redline_markers_updated_at
before update on public.redline_markers
for each row execute function public.set_redline_markers_updated_at();

create or replace function public.fn_redline_project_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles p
    join public.projects pr on pr.id = p_project_id
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          pr.org_id = p.org_id
          and (
            public.effective_role_code(p.role_code, p.role) in ('OWNER','ADMIN','PROJECT_MANAGER','SUPPORT')
            or exists (
              select 1
              from public.project_members pm
              where pm.project_id = p_project_id
                and pm.user_id = auth.uid()
            )
          )
        )
      )
  );
$$;

create or replace function public.fn_redline_marker_manage(p_project_id uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles p
    join public.projects pr on pr.id = p_project_id
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          pr.org_id = p.org_id
          and (
            p_created_by = auth.uid()
            or public.effective_role_code(p.role_code, p.role) = 'ADMIN'
          )
        )
      )
  );
$$;

alter table public.redline_markers enable row level security;

drop policy if exists "redline_markers_select_project_access" on public.redline_markers;
create policy "redline_markers_select_project_access"
on public.redline_markers for select
to authenticated
using (public.fn_redline_project_access(project_id));

drop policy if exists "redline_markers_insert_authed" on public.redline_markers;
create policy "redline_markers_insert_authed"
on public.redline_markers for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.fn_redline_project_access(project_id)
);

drop policy if exists "redline_markers_update_creator_or_admin" on public.redline_markers;
create policy "redline_markers_update_creator_or_admin"
on public.redline_markers for update
to authenticated
using (public.fn_redline_marker_manage(project_id, created_by))
with check (public.fn_redline_marker_manage(project_id, created_by));

drop policy if exists "redline_markers_delete_creator_or_admin" on public.redline_markers;
create policy "redline_markers_delete_creator_or_admin"
on public.redline_markers for delete
to authenticated
using (public.fn_redline_marker_manage(project_id, created_by));

notify pgrst, 'reload schema';
