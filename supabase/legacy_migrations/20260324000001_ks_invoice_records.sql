-- K&S invoice import batches + invoice records for Excel deep links.

create table if not exists public.ks_invoice_import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete set null,
  uploaded_zip_name text not null,
  total_files integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ks_invoice_batches_org_created
  on public.ks_invoice_import_batches(org_id, created_at desc);

create table if not exists public.ks_invoice_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete set null,
  invoice_number text not null,
  invoice_number_norm text not null,
  customer_name text not null default 'K & S Electric',
  source_filename text not null default '',
  source_file_path text not null default '',
  source_mime text not null default 'application/pdf',
  import_batch_id uuid null references public.ks_invoice_import_batches(id) on delete set null,
  imported_at timestamptz not null default now(),
  status text not null default 'imported',
  notes text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  extracted_data jsonb not null default '{}'::jsonb,
  created_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_ks_invoice_records_org_invoice_norm
  on public.ks_invoice_records(org_id, invoice_number_norm);

create index if not exists idx_ks_invoice_records_org_imported
  on public.ks_invoice_records(org_id, imported_at desc);

grant select, insert, update, delete on public.ks_invoice_import_batches to authenticated;
grant select, insert, update, delete on public.ks_invoice_records to authenticated;

alter table public.ks_invoice_import_batches enable row level security;
alter table public.ks_invoice_records enable row level security;

drop policy if exists ks_invoice_batches_select_policy on public.ks_invoice_import_batches;
create policy ks_invoice_batches_select_policy
on public.ks_invoice_import_batches
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        (upper(coalesce(to_jsonb(p)->>'role_code','')) = 'ROOT' or upper(coalesce(to_jsonb(p)->>'role','')) = 'ROOT')
        or (p.org_id = ks_invoice_import_batches.org_id and coalesce(p.can_view_invoices, false))
      )
  )
);

drop policy if exists ks_invoice_batches_insert_policy on public.ks_invoice_import_batches;
create policy ks_invoice_batches_insert_policy
on public.ks_invoice_import_batches
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        (upper(coalesce(to_jsonb(p)->>'role_code','')) = 'ROOT' or upper(coalesce(to_jsonb(p)->>'role','')) = 'ROOT')
        or (p.org_id = ks_invoice_import_batches.org_id and coalesce(p.can_view_invoices, false))
      )
  )
);

drop policy if exists ks_invoice_batches_update_policy on public.ks_invoice_import_batches;
create policy ks_invoice_batches_update_policy
on public.ks_invoice_import_batches
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        (upper(coalesce(to_jsonb(p)->>'role_code','')) = 'ROOT' or upper(coalesce(to_jsonb(p)->>'role','')) = 'ROOT')
        or (p.org_id = ks_invoice_import_batches.org_id and coalesce(p.can_view_invoices, false))
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        (upper(coalesce(to_jsonb(p)->>'role_code','')) = 'ROOT' or upper(coalesce(to_jsonb(p)->>'role','')) = 'ROOT')
        or (p.org_id = ks_invoice_import_batches.org_id and coalesce(p.can_view_invoices, false))
      )
  )
);

drop policy if exists ks_invoice_batches_delete_policy on public.ks_invoice_import_batches;
create policy ks_invoice_batches_delete_policy
on public.ks_invoice_import_batches
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (upper(coalesce(to_jsonb(p)->>'role_code','')) = 'ROOT' or upper(coalesce(to_jsonb(p)->>'role','')) = 'ROOT')
  )
);

drop policy if exists ks_invoice_records_select_policy on public.ks_invoice_records;
create policy ks_invoice_records_select_policy
on public.ks_invoice_records
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        (upper(coalesce(to_jsonb(p)->>'role_code','')) = 'ROOT' or upper(coalesce(to_jsonb(p)->>'role','')) = 'ROOT')
        or (p.org_id = ks_invoice_records.org_id and coalesce(p.can_view_invoices, false))
      )
  )
);

drop policy if exists ks_invoice_records_insert_policy on public.ks_invoice_records;
create policy ks_invoice_records_insert_policy
on public.ks_invoice_records
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        (upper(coalesce(to_jsonb(p)->>'role_code','')) = 'ROOT' or upper(coalesce(to_jsonb(p)->>'role','')) = 'ROOT')
        or (p.org_id = ks_invoice_records.org_id and coalesce(p.can_view_invoices, false))
      )
  )
);

drop policy if exists ks_invoice_records_update_policy on public.ks_invoice_records;
create policy ks_invoice_records_update_policy
on public.ks_invoice_records
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        (upper(coalesce(to_jsonb(p)->>'role_code','')) = 'ROOT' or upper(coalesce(to_jsonb(p)->>'role','')) = 'ROOT')
        or (p.org_id = ks_invoice_records.org_id and coalesce(p.can_view_invoices, false))
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        (upper(coalesce(to_jsonb(p)->>'role_code','')) = 'ROOT' or upper(coalesce(to_jsonb(p)->>'role','')) = 'ROOT')
        or (p.org_id = ks_invoice_records.org_id and coalesce(p.can_view_invoices, false))
      )
  )
);

drop policy if exists ks_invoice_records_delete_policy on public.ks_invoice_records;
create policy ks_invoice_records_delete_policy
on public.ks_invoice_records
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (upper(coalesce(to_jsonb(p)->>'role_code','')) = 'ROOT' or upper(coalesce(to_jsonb(p)->>'role','')) = 'ROOT')
  )
);



