create or replace function public.fn_import_sites(p_project_id uuid, p_sites jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_code text;
  v_org_id uuid;
  v_project_org_id uuid;
  v_row jsonb;
  v_site_id uuid;
  v_imported int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_name text;
  v_lat double precision;
  v_lng double precision;
  v_finish text;
  v_map text;
  v_gps text;
  v_notes text;
  v_items jsonb;
  v_codes jsonb;
  v_photo_urls jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select public.effective_role_code(p.role_code, p.role), p.org_id
    into v_role_code, v_org_id
  from public.profiles p
  where p.id = v_user_id;

  if v_role_code is null or v_role_code not in ('OWNER','ADMIN','PROJECT_MANAGER','SUPPORT','ROOT') then
    raise exception 'Not authorized';
  end if;

  select pr.org_id
    into v_project_org_id
  from public.projects pr
  where pr.id = p_project_id;

  if v_project_org_id is null then
    raise exception 'Project not found';
  end if;

  if v_role_code <> 'ROOT' and (v_org_id is null or v_org_id <> v_project_org_id) then
    raise exception 'Not authorized for project org';
  end if;

  if p_sites is null or jsonb_typeof(p_sites) <> 'array' then
    raise exception 'Invalid payload';
  end if;

  for v_row in select * from jsonb_array_elements(p_sites)
  loop
    begin
      v_name := nullif(trim(coalesce(v_row->>'location_name','')), '');
      v_lat := (v_row->>'latitude')::double precision;
      v_lng := (v_row->>'longitude')::double precision;
      v_finish := nullif(trim(coalesce(v_row->>'finish_date','')), '');
      v_map := nullif(trim(coalesce(v_row->>'map_url','')), '');
      v_gps := nullif(trim(coalesce(v_row->>'gps_status','')), '');
      v_notes := nullif(trim(coalesce(v_row->>'notes','')), '');
      v_items := v_row->'items';
      v_codes := v_row->'billing_codes';
      v_photo_urls := v_row->'photo_urls';

      if v_name is null or v_lat is null or v_lng is null then
        v_skipped := v_skipped + 1;
        v_errors := v_errors || jsonb_build_object(
          'row', coalesce(v_row->>'__rowNumber','?'),
          'reason', 'Missing required fields'
        );
        continue;
      end if;

      insert into public.sites (project_id, name, gps_lat, gps_lng, created_by, notes)
      values (
        p_project_id,
        v_name,
        v_lat,
        v_lng,
        v_user_id,
        coalesce(
          v_notes,
          case
            when v_finish is not null or v_map is not null or v_gps is not null
              then jsonb_build_object('finish_date', v_finish, 'map_url', v_map, 'gps_status', v_gps)::text
            else null
          end
        )
      )
      returning id into v_site_id;

      if v_items is not null and jsonb_typeof(v_items) = 'array' then
        insert into public.site_entries (site_id, description, quantity, created_by)
        select v_site_id,
               nullif(trim(coalesce(item->>'item','')), ''),
               nullif(item->>'qty','')::numeric,
               v_user_id
        from jsonb_array_elements(v_items) as item
        where nullif(trim(coalesce(item->>'item','')), '') is not null;
      end if;

      if v_codes is not null and jsonb_typeof(v_codes) = 'array' then
        insert into public.site_codes (site_id, code)
        select v_site_id, code
        from (
          select distinct nullif(trim(value), '') as code
          from jsonb_array_elements_text(v_codes)
        ) dedup
        where dedup.code is not null;
      end if;

      if v_photo_urls is not null and jsonb_typeof(v_photo_urls) = 'array' then
        insert into public.site_media (site_id, media_path, gps_lat, gps_lng, created_by, created_at)
        select v_site_id, media_url, v_lat, v_lng, v_user_id, now()
        from (
          select nullif(trim(value), '') as media_url
          from jsonb_array_elements_text(v_photo_urls)
        ) urls
        where urls.media_url ~* '^https?://';
      end if;

      v_imported := v_imported + 1;
    exception when others then
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object(
        'row', coalesce(v_row->>'__rowNumber','?'),
        'reason', sqlerrm
      );
    end;
  end loop;

  return jsonb_build_object(
    'imported', v_imported,
    'skipped', v_skipped,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.fn_import_sites(uuid, jsonb) from public;
grant execute on function public.fn_import_sites(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
