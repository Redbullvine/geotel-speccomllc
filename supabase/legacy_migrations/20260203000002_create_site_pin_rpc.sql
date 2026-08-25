-- Drop Pin RPC for app compatibility
create or replace function public.fn_create_site_pin(
  p_lat double precision,
  p_lng double precision,
  p_project_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_site_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_project_id is null then
    raise exception 'Project required';
  end if;

  if not public.has_project_access(p_project_id) then
    raise exception 'Not allowed';
  end if;

  insert into public.sites (project_id, name, gps_lat, gps_lng, created_by)
  values (p_project_id, 'Pinned site', p_lat, p_lng, v_user_id)
  returning id into v_site_id;

  return v_site_id;
end;
$$;

revoke all on function public.fn_create_site_pin(double precision, double precision, uuid) from public;
grant execute on function public.fn_create_site_pin(double precision, double precision, uuid) to authenticated;

notify pgrst, 'reload schema';
