-- Mobile subcontractor onboarding workflow.
-- Keeps documents private and gates admin review through RLS + RPC helpers.

alter table public.profiles
  drop constraint if exists profiles_role_valid;

alter table public.profiles
  add constraint profiles_role_valid
  check (role in ('ROOT','OWNER','ADMIN','OFFICE','SUPPORT','PRIME','TDS','SUB','SUBCONTRACTOR','SPLICER','TECHNICIAN'));

alter table if exists public.profile_invites
  drop constraint if exists profile_invites_role_valid;

alter table if exists public.profile_invites
  add constraint profile_invites_role_valid
  check (role in ('ROOT','OWNER','ADMIN','OFFICE','SUPPORT','PRIME','TDS','SUB','SUBCONTRACTOR','SPLICER','TECHNICIAN'));

create or replace function public.fn_is_onboarding_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and upper(coalesce(p.role, '')) in ('ROOT','OWNER','ADMIN','OFFICE','SUPPORT')
  );
$$;

revoke all on function public.fn_is_onboarding_admin() from public;
grant execute on function public.fn_is_onboarding_admin() to authenticated;

create table if not exists public.subcontractor_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) unique not null,
  full_name text,
  company_name text,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  emergency_contact_name text,
  emergency_contact_phone text,
  onboarding_status text default 'draft',
  admin_notes text,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint subcontractor_profiles_status_check
    check (onboarding_status in ('draft','submitted','missing_info','approved','rejected'))
);

create index if not exists subcontractor_profiles_user_idx
  on public.subcontractor_profiles(user_id);

create index if not exists subcontractor_profiles_status_idx
  on public.subcontractor_profiles(onboarding_status, submitted_at desc);

create table if not exists public.subcontractor_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  document_type text not null,
  file_path text not null,
  file_name text,
  mime_type text,
  status text default 'uploaded',
  rejection_reason text,
  expires_at date,
  uploaded_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  constraint subcontractor_documents_type_check
    check (document_type in ('w9','driver_license','insurance_coi','direct_deposit','other')),
  constraint subcontractor_documents_status_check
    check (status in ('uploaded','accepted','rejected'))
);

create index if not exists subcontractor_documents_user_idx
  on public.subcontractor_documents(user_id, document_type, uploaded_at desc);

create table if not exists public.subcontractor_agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  agreement_type text not null,
  agreement_version text not null default '2026-06',
  signer_name text not null,
  signature_data text not null,
  accepted_terms boolean default false,
  signed_at timestamptz default now(),
  ip_address text,
  user_agent text,
  constraint subcontractor_agreements_type_check
    check (agreement_type in ('subcontractor_agreement','safety_acknowledgment','work_rules'))
);

create index if not exists subcontractor_agreements_user_idx
  on public.subcontractor_agreements(user_id, agreement_type, signed_at desc);

create or replace function public.fn_touch_subcontractor_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_subcontractor_profiles on public.subcontractor_profiles;
create trigger trg_touch_subcontractor_profiles
before update on public.subcontractor_profiles
for each row
execute function public.fn_touch_subcontractor_updated_at();

create or replace function public.fn_guard_subcontractor_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.fn_is_onboarding_admin() then
    return new;
  end if;

  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'Not authorized';
  end if;

  if current_setting('app.subcontractor_submit', true) = '1' then
    return new;
  end if;

  if new.onboarding_status is distinct from old.onboarding_status
    or new.admin_notes is distinct from old.admin_notes
    or new.submitted_at is distinct from old.submitted_at
    or new.approved_at is distinct from old.approved_at
    or new.approved_by is distinct from old.approved_by then
    raise exception 'Onboarding review fields cannot be self-updated';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_subcontractor_profile_self_update on public.subcontractor_profiles;
create trigger trg_guard_subcontractor_profile_self_update
before update on public.subcontractor_profiles
for each row
execute function public.fn_guard_subcontractor_profile_self_update();

alter table public.subcontractor_profiles enable row level security;
alter table public.subcontractor_documents enable row level security;
alter table public.subcontractor_agreements enable row level security;

drop policy if exists "subcontractor_profiles_select_own_or_admin" on public.subcontractor_profiles;
create policy "subcontractor_profiles_select_own_or_admin"
on public.subcontractor_profiles
for select
to authenticated
using (user_id = auth.uid() or public.fn_is_onboarding_admin());

drop policy if exists "subcontractor_profiles_insert_own" on public.subcontractor_profiles;
create policy "subcontractor_profiles_insert_own"
on public.subcontractor_profiles
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "subcontractor_profiles_update_own_or_admin" on public.subcontractor_profiles;
create policy "subcontractor_profiles_update_own_or_admin"
on public.subcontractor_profiles
for update
to authenticated
using (user_id = auth.uid() or public.fn_is_onboarding_admin())
with check (user_id = auth.uid() or public.fn_is_onboarding_admin());

drop policy if exists "subcontractor_documents_select_own_or_admin" on public.subcontractor_documents;
create policy "subcontractor_documents_select_own_or_admin"
on public.subcontractor_documents
for select
to authenticated
using (user_id = auth.uid() or public.fn_is_onboarding_admin());

drop policy if exists "subcontractor_documents_insert_own" on public.subcontractor_documents;
create policy "subcontractor_documents_insert_own"
on public.subcontractor_documents
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "subcontractor_documents_update_admin" on public.subcontractor_documents;
create policy "subcontractor_documents_update_admin"
on public.subcontractor_documents
for update
to authenticated
using (public.fn_is_onboarding_admin())
with check (public.fn_is_onboarding_admin());

drop policy if exists "subcontractor_agreements_select_own_or_admin" on public.subcontractor_agreements;
create policy "subcontractor_agreements_select_own_or_admin"
on public.subcontractor_agreements
for select
to authenticated
using (user_id = auth.uid() or public.fn_is_onboarding_admin());

drop policy if exists "subcontractor_agreements_insert_own" on public.subcontractor_agreements;
create policy "subcontractor_agreements_insert_own"
on public.subcontractor_agreements
for insert
to authenticated
with check (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'subcontractor-documents',
  'subcontractor-documents',
  false,
  20971520,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream'
  ]
)
on conflict (id) do update set public = false;

drop policy if exists "subcontractor_documents_storage_select" on storage.objects;
create policy "subcontractor_documents_storage_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'subcontractor-documents'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.fn_is_onboarding_admin()
  )
);

drop policy if exists "subcontractor_documents_storage_insert_own" on storage.objects;
create policy "subcontractor_documents_storage_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'subcontractor-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "subcontractor_documents_storage_update_admin" on storage.objects;
create policy "subcontractor_documents_storage_update_admin"
on storage.objects
for update
to authenticated
using (bucket_id = 'subcontractor-documents' and public.fn_is_onboarding_admin())
with check (bucket_id = 'subcontractor-documents' and public.fn_is_onboarding_admin());

drop policy if exists "subcontractor_documents_storage_delete_admin" on storage.objects;
create policy "subcontractor_documents_storage_delete_admin"
on storage.objects
for delete
to authenticated
using (bucket_id = 'subcontractor-documents' and public.fn_is_onboarding_admin());

create or replace function public.fn_subcontractor_onboarding_missing(p_user_id uuid default auth.uid())
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile public.subcontractor_profiles%rowtype;
  v_missing text[] := array[]::text[];
begin
  if p_user_id is null then
    return array['Signed-in user']::text[];
  end if;

  if p_user_id <> auth.uid() and not public.fn_is_onboarding_admin() then
    raise exception 'Not authorized';
  end if;

  select * into v_profile
  from public.subcontractor_profiles
  where user_id = p_user_id;

  if v_profile.user_id is null then
    return array[
      'Profile',
      'Emergency contact',
      'W-9 document',
      'Driver license',
      'Insurance COI',
      'Subcontractor agreement',
      'Safety and work rules acknowledgment'
    ]::text[];
  end if;

  if nullif(trim(coalesce(v_profile.full_name, '')), '') is null then v_missing := v_missing || 'Full name'; end if;
  if nullif(trim(coalesce(v_profile.phone, '')), '') is null then v_missing := v_missing || 'Phone'; end if;
  if nullif(trim(coalesce(v_profile.email, '')), '') is null then v_missing := v_missing || 'Email'; end if;
  if nullif(trim(coalesce(v_profile.address_line1, '')), '') is null
    or nullif(trim(coalesce(v_profile.city, '')), '') is null
    or nullif(trim(coalesce(v_profile.state, '')), '') is null
    or nullif(trim(coalesce(v_profile.zip, '')), '') is null then
    v_missing := v_missing || 'Address';
  end if;
  if nullif(trim(coalesce(v_profile.emergency_contact_name, '')), '') is null
    or nullif(trim(coalesce(v_profile.emergency_contact_phone, '')), '') is null then
    v_missing := v_missing || 'Emergency contact';
  end if;

  if not exists (
    select 1 from public.subcontractor_documents
    where user_id = p_user_id and document_type = 'w9' and status <> 'rejected'
  ) then v_missing := v_missing || 'W-9 document'; end if;

  if not exists (
    select 1 from public.subcontractor_documents
    where user_id = p_user_id and document_type = 'driver_license' and status <> 'rejected'
  ) then v_missing := v_missing || 'Driver license'; end if;

  if not exists (
    select 1 from public.subcontractor_documents
    where user_id = p_user_id and document_type = 'insurance_coi' and status <> 'rejected'
  ) then v_missing := v_missing || 'Insurance COI'; end if;

  if not exists (
    select 1 from public.subcontractor_agreements
    where user_id = p_user_id
      and agreement_type = 'subcontractor_agreement'
      and accepted_terms is true
      and nullif(trim(signature_data), '') is not null
  ) then v_missing := v_missing || 'Subcontractor agreement'; end if;

  if not exists (
    select 1 from public.subcontractor_agreements
    where user_id = p_user_id
      and agreement_type = 'safety_acknowledgment'
      and accepted_terms is true
      and nullif(trim(signature_data), '') is not null
  ) then v_missing := v_missing || 'Safety and work rules acknowledgment'; end if;

  return v_missing;
end;
$$;

revoke all on function public.fn_subcontractor_onboarding_missing(uuid) from public;
grant execute on function public.fn_subcontractor_onboarding_missing(uuid) to authenticated;

create or replace function public.fn_submit_subcontractor_onboarding()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_missing text[];
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_missing := public.fn_subcontractor_onboarding_missing(v_user_id);
  if array_length(v_missing, 1) is not null then
    return jsonb_build_object('ok', false, 'missing', v_missing);
  end if;

  perform set_config('app.subcontractor_submit', '1', true);

  update public.subcontractor_profiles
  set onboarding_status = 'submitted',
      submitted_at = now(),
      admin_notes = null,
      approved_at = null,
      approved_by = null
  where user_id = v_user_id;

  return jsonb_build_object('ok', true, 'status', 'submitted');
end;
$$;

revoke all on function public.fn_submit_subcontractor_onboarding() from public;
grant execute on function public.fn_submit_subcontractor_onboarding() to authenticated;

create or replace function public.fn_review_subcontractor_document(
  p_document_id uuid,
  p_status text,
  p_rejection_reason text default null,
  p_expires_at date default null
)
returns public.subcontractor_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
  v_row public.subcontractor_documents;
begin
  if not public.fn_is_onboarding_admin() then
    raise exception 'Not authorized';
  end if;

  if v_status not in ('accepted','rejected','uploaded') then
    raise exception 'Invalid document status';
  end if;

  update public.subcontractor_documents
  set status = v_status,
      rejection_reason = case when v_status = 'rejected' then nullif(trim(coalesce(p_rejection_reason, '')), '') else null end,
      expires_at = p_expires_at,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_document_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Document not found';
  end if;

  return v_row;
end;
$$;

revoke all on function public.fn_review_subcontractor_document(uuid, text, text, date) from public;
grant execute on function public.fn_review_subcontractor_document(uuid, text, text, date) to authenticated;

create or replace function public.fn_set_subcontractor_onboarding_status(
  p_user_id uuid,
  p_status text,
  p_admin_notes text default null
)
returns public.subcontractor_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
  v_row public.subcontractor_profiles;
begin
  if not public.fn_is_onboarding_admin() then
    raise exception 'Not authorized';
  end if;

  if v_status not in ('draft','submitted','missing_info','approved','rejected') then
    raise exception 'Invalid onboarding status';
  end if;

  update public.subcontractor_profiles
  set onboarding_status = v_status,
      admin_notes = nullif(trim(coalesce(p_admin_notes, '')), ''),
      approved_at = case when v_status = 'approved' then now() else approved_at end,
      approved_by = case when v_status = 'approved' then auth.uid() else approved_by end
  where user_id = p_user_id
  returning * into v_row;

  if v_row.user_id is null then
    raise exception 'Onboarding profile not found';
  end if;

  return v_row;
end;
$$;

revoke all on function public.fn_set_subcontractor_onboarding_status(uuid, text, text) from public;
grant execute on function public.fn_set_subcontractor_onboarding_status(uuid, text, text) to authenticated;

-- Keep invite helpers aligned with the expanded role vocabulary.
create or replace function public.fn_upsert_profile_invite(
  p_email       text,
  p_role        text    default 'SPLICER',
  p_display_name text   default null,
  p_org_id      uuid   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id   uuid := auth.uid();
  v_actor_org  uuid;
  v_actor_role text;
  v_email      text := lower(trim(coalesce(p_email, '')));
  v_org_id     uuid;
  v_role       text := upper(trim(coalesce(p_role, 'SPLICER')));
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  select p.org_id, p.role
    into v_actor_org, v_actor_role
  from public.profiles p
  where p.id = v_actor_id;

  if v_actor_role not in ('ROOT','ADMIN','OWNER','OFFICE','SUPPORT') then
    raise exception 'Not authorized';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Valid email required';
  end if;

  if v_role = 'SUBCONTRACTOR' then
    v_role := 'SUBCONTRACTOR';
  elsif v_role not in ('ROOT','OWNER','ADMIN','OFFICE','SUPPORT','PRIME','TDS','SUB','SPLICER','TECHNICIAN') then
    v_role := 'SPLICER';
  end if;

  if v_role = 'ROOT' and v_actor_role <> 'ROOT' then
    raise exception 'Only ROOT can assign the ROOT role';
  end if;

  v_org_id := coalesce(p_org_id, v_actor_org);
  if v_org_id is null then
    raise exception 'Organization is required';
  end if;

  if v_actor_role <> 'ROOT' and v_org_id <> v_actor_org then
    raise exception 'Cannot invite outside your organization';
  end if;

  insert into public.profile_invites (email, org_id, role, display_name, created_by, updated_at)
  values (
    v_email, v_org_id, v_role,
    nullif(trim(coalesce(p_display_name, '')), ''),
    v_actor_id, now()
  )
  on conflict (email) do update set
    org_id       = excluded.org_id,
    role         = excluded.role,
    display_name = coalesce(excluded.display_name, public.profile_invites.display_name),
    created_by   = excluded.created_by,
    updated_at   = now();

  return jsonb_build_object('email', v_email, 'org_id', v_org_id, 'role', v_role);
end
$$;

revoke all on function public.fn_upsert_profile_invite(text, text, text, uuid) from public;
grant execute on function public.fn_upsert_profile_invite(text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
