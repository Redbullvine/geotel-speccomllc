alter table if exists public.splice_location_photos
  add column if not exists proof_type text,
  add column if not exists device_user_agent text,
  add column if not exists created_at_server timestamptz not null default now(),
  add column if not exists captured_at_locked boolean not null default true,
  add column if not exists gps_locked boolean not null default true;

alter table if exists public.splice_location_photos
  alter column source set default 'camera';

update public.splice_location_photos
set
  source = case
    when coalesce(backfilled, false) then 'backfill_upload'
    else 'camera'
  end,
  proof_type = coalesce(nullif(proof_type, ''), slot_key)
where coalesce(source, '') in ('', 'upload')
   or coalesce(proof_type, '') = '';

alter table if exists public.site_media
  add column if not exists source text not null default 'reference_upload',
  add column if not exists proof_type text,
  add column if not exists is_live_proof boolean not null default false,
  add column if not exists backfilled boolean not null default false,
  add column if not exists device_user_agent text,
  add column if not exists captured_at_locked boolean not null default true,
  add column if not exists gps_locked boolean not null default true;

update public.site_media
set
  source = coalesce(nullif(source, ''), 'reference_upload'),
  gps_locked = case
    when gps_lat is not null and gps_lng is not null then true
    else coalesce(gps_locked, false)
  end,
  captured_at_locked = true
where coalesce(source, '') = ''
   or captured_at_locked is distinct from true
   or (gps_lat is not null and gps_lng is not null and gps_locked is distinct from true);

notify pgrst, 'reload schema';
