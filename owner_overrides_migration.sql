-- Owner override support (backfill + billing unlock)

create table if not exists public.owner_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  splice_location_id uuid references public.splice_locations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  override_type text not null check (override_type in ('BACKFILL_ALLOWED','BILLING_UNLOCKED')),
  reason text not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.owner_overrides enable row level security;

create policy "owner_overrides_read_project"
on public.owner_overrides for select
to authenticated
using (public.has_project_access(project_id));

create policy "owner_overrides_insert_owner"
on public.owner_overrides for insert
to authenticated
with check (public.current_project_role(project_id) = 'OWNER');

create or replace function public.create_owner_override(
  p_project_id uuid,
  p_node_id uuid,
  p_override_type text,
  p_reason text,
  p_splice_location_id uuid default null
)
returns public.owner_overrides
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.owner_overrides;
begin
  if public.current_project_role(p_project_id) <> 'OWNER' then
    raise exception 'Owner role required.';
  end if;
  insert into public.owner_overrides (
    project_id, node_id, splice_location_id, override_type, reason, created_by
  ) values (
    p_project_id, p_node_id, p_splice_location_id, p_override_type, p_reason, auth.uid()
  )
  returning * into rec;
  return rec;
end $$;

alter table public.splice_location_photos
  add column if not exists source text default 'camera',
  add column if not exists backfilled boolean not null default false,
  add column if not exists exif_taken_at timestamptz;
