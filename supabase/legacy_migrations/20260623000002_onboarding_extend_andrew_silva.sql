-- Extend onboarding schema to cover Andrew Silva's full 1099 subcontractor package.
-- Adds workers_comp document type, bucket_truck_agreement and
-- rate_sheet_acknowledgment agreement types, and updates the
-- missing-items checker to gate on all required steps.
-- Apply after 20260623000001_subcontractor_onboarding.sql.

-- 1. Extend allowed document_type values to include workers_comp.
alter table public.subcontractor_documents
  drop constraint if exists subcontractor_documents_type_check;

alter table public.subcontractor_documents
  add constraint subcontractor_documents_type_check
  check (document_type in (
    'w9',
    'driver_license',
    'insurance_coi',
    'workers_comp',
    'direct_deposit',
    'other'
  ));

-- 2. Extend allowed agreement_type values to include bucket truck and rate sheet.
alter table public.subcontractor_agreements
  drop constraint if exists subcontractor_agreements_type_check;

alter table public.subcontractor_agreements
  add constraint subcontractor_agreements_type_check
  check (agreement_type in (
    'subcontractor_agreement',
    'bucket_truck_agreement',
    'rate_sheet_acknowledgment',
    'safety_acknowledgment',
    'work_rules'
  ));

-- 3. Update missing-items checker to require all steps in Andrew's package.
--    workers_comp is intentionally excluded from required gates here because
--    it is conditional on state exemption status — admin reviews it separately.
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
      'Bucket truck agreement',
      'Rate sheet acknowledgment',
      'Safety and work rules acknowledgment'
    ]::text[];
  end if;

  -- Profile fields
  if nullif(trim(coalesce(v_profile.full_name, '')), '') is null
    then v_missing := v_missing || 'Full name'; end if;
  if nullif(trim(coalesce(v_profile.phone, '')), '') is null
    then v_missing := v_missing || 'Phone'; end if;
  if nullif(trim(coalesce(v_profile.email, '')), '') is null
    then v_missing := v_missing || 'Email'; end if;
  if nullif(trim(coalesce(v_profile.address_line1, '')), '') is null
    or nullif(trim(coalesce(v_profile.city, '')), '') is null
    or nullif(trim(coalesce(v_profile.state, '')), '') is null
    or nullif(trim(coalesce(v_profile.zip, '')), '') is null
    then v_missing := v_missing || 'Address'; end if;

  -- Emergency contact
  if nullif(trim(coalesce(v_profile.emergency_contact_name, '')), '') is null
    or nullif(trim(coalesce(v_profile.emergency_contact_phone, '')), '') is null
    then v_missing := v_missing || 'Emergency contact'; end if;

  -- Required uploads
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

  -- Required signatures / acknowledgments
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
      and agreement_type = 'bucket_truck_agreement'
      and accepted_terms is true
      and nullif(trim(signature_data), '') is not null
  ) then v_missing := v_missing || 'Bucket truck agreement'; end if;

  if not exists (
    select 1 from public.subcontractor_agreements
    where user_id = p_user_id
      and agreement_type = 'rate_sheet_acknowledgment'
      and accepted_terms is true
      and nullif(trim(signature_data), '') is not null
  ) then v_missing := v_missing || 'Rate sheet acknowledgment'; end if;

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

notify pgrst, 'reload schema';
