-- Invoice file vault + ROOT-granted visibility.

alter table public.profiles
  add column if not exists can_view_invoices boolean not null default false;

comment on column public.profiles.can_view_invoices is
  'When true, user can view invoice vault files for their org. ROOT can always view.';

create table if not exists public.invoice_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete set null,
  file_name text not null,
  file_path text not null,
  uploaded_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_invoice_files_org_created
  on public.invoice_files(org_id, created_at desc);

create index if not exists idx_invoice_files_project
  on public.invoice_files(project_id);

alter table public.invoice_files enable row level security;

grant select, insert, update, delete on public.invoice_files to authenticated;

drop policy if exists invoice_files_select_policy on public.invoice_files;
create policy invoice_files_select_policy
on public.invoice_files
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (p.org_id = invoice_files.org_id and coalesce(p.can_view_invoices, false))
      )
  )
);

drop policy if exists invoice_files_insert_policy on public.invoice_files;
create policy invoice_files_insert_policy
on public.invoice_files
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (p.org_id = invoice_files.org_id and coalesce(p.can_view_invoices, false))
      )
  )
);

drop policy if exists invoice_files_update_policy on public.invoice_files;
create policy invoice_files_update_policy
on public.invoice_files
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and public.effective_role_code(p.role_code, p.role) = 'ROOT'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and public.effective_role_code(p.role_code, p.role) = 'ROOT'
  )
);

drop policy if exists invoice_files_delete_policy on public.invoice_files;
create policy invoice_files_delete_policy
on public.invoice_files
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and public.effective_role_code(p.role_code, p.role) = 'ROOT'
  )
);

create or replace function public.fn_guard_profile_invoice_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if new.can_view_invoices is not distinct from old.can_view_invoices then
    return new;
  end if;
  if v_actor_id is null then
    return new;
  end if;

  select public.effective_role_code(p.role_code, p.role)
    into v_actor_role
  from public.profiles p
  where p.id = v_actor_id;

  if v_actor_role is distinct from 'ROOT' then
    raise exception 'Only ROOT can grant invoice visibility';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_invoice_visibility on public.profiles;
create trigger trg_guard_profile_invoice_visibility
before update on public.profiles
for each row
execute function public.fn_guard_profile_invoice_visibility();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoice-files',
  'invoice-files',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/zip',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  ]::text[]
)
on conflict (id) do nothing;

drop policy if exists invoice_files_storage_select on storage.objects;
create policy invoice_files_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'invoice-files'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          coalesce(p.can_view_invoices, false)
          and p.org_id::text = (storage.foldername(name))[1]
        )
      )
  )
);

drop policy if exists invoice_files_storage_insert on storage.objects;
create policy invoice_files_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'invoice-files'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          coalesce(p.can_view_invoices, false)
          and p.org_id::text = (storage.foldername(name))[1]
        )
      )
  )
);

drop policy if exists invoice_files_storage_delete on storage.objects;
create policy invoice_files_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'invoice-files'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and public.effective_role_code(p.role_code, p.role) = 'ROOT'
  )
);
