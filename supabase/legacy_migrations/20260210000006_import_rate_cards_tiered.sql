create or replace function public.fn_import_rate_cards_tiered(
  p_project_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_code text;
  v_row jsonb;
  v_imported int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_code text;
  v_desc text;
  v_unit text;
  v_rate numeric;
  v_work_id uuid;
  v_card_user1 uuid;
  v_card_user2 uuid;
  v_card_owner uuid;
  v_rate_user2 numeric;
  v_rate_owner numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select public.effective_role_code(p.role_code, p.role)
    into v_role_code
  from public.profiles p
  where p.id = v_user_id;

  if v_role_code is null or v_role_code <> 'ROOT' then
    raise exception 'Not authorized';
  end if;

  if p_project_id is null then
    raise exception 'Project required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Invalid payload';
  end if;

  select id into v_card_user1
  from public.rate_cards
  where project_id = p_project_id and name = 'USER_LEVEL_1'
  limit 1;
  if v_card_user1 is null then
    insert into public.rate_cards (name, project_id)
    values ('USER_LEVEL_1', p_project_id)
    returning id into v_card_user1;
  end if;

  select id into v_card_user2
  from public.rate_cards
  where project_id = p_project_id and name = 'USER_LEVEL_2'
  limit 1;
  if v_card_user2 is null then
    insert into public.rate_cards (name, project_id)
    values ('USER_LEVEL_2', p_project_id)
    returning id into v_card_user2;
  end if;

  select id into v_card_owner
  from public.rate_cards
  where project_id = p_project_id and name = 'OWNER'
  limit 1;
  if v_card_owner is null then
    insert into public.rate_cards (name, project_id)
    values ('OWNER', p_project_id)
    returning id into v_card_owner;
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    begin
      v_code := nullif(trim(coalesce(v_row->>'code','')), '');
      v_desc := nullif(trim(coalesce(v_row->>'description','')), '');
      v_unit := nullif(trim(coalesce(v_row->>'unit','')), '');
      v_rate := nullif(trim(coalesce(v_row->>'rate','')), '')::numeric;

      if v_code is null or v_rate is null then
        v_skipped := v_skipped + 1;
        v_errors := v_errors || jsonb_build_object(
          'row', coalesce(v_row->>'__rowNumber','?'),
          'reason', 'Missing code or rate'
        );
        continue;
      end if;

      select id into v_work_id
      from public.work_codes
      where upper(code) = upper(v_code)
      limit 1;

      if v_work_id is null then
        insert into public.work_codes (code, description, unit, default_rate)
        values (v_code, v_desc, v_unit, v_rate)
        returning id into v_work_id;
      else
        update public.work_codes
        set description = coalesce(v_desc, description),
            unit = coalesce(v_unit, unit),
            default_rate = v_rate
        where id = v_work_id;
      end if;

      v_rate_user2 := round(v_rate * 1.25, 2);
      v_rate_owner := round(v_rate_user2 * 1.25, 2);

      update public.rate_card_items
      set rate = v_rate
      where rate_card_id = v_card_user1 and work_code_id = v_work_id;
      if not found then
        insert into public.rate_card_items (rate_card_id, work_code_id, rate)
        values (v_card_user1, v_work_id, v_rate);
      end if;

      update public.rate_card_items
      set rate = v_rate_user2
      where rate_card_id = v_card_user2 and work_code_id = v_work_id;
      if not found then
        insert into public.rate_card_items (rate_card_id, work_code_id, rate)
        values (v_card_user2, v_work_id, v_rate_user2);
      end if;

      update public.rate_card_items
      set rate = v_rate_owner
      where rate_card_id = v_card_owner and work_code_id = v_work_id;
      if not found then
        insert into public.rate_card_items (rate_card_id, work_code_id, rate)
        values (v_card_owner, v_work_id, v_rate_owner);
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

revoke all on function public.fn_import_rate_cards_tiered(uuid, jsonb) from public;
grant execute on function public.fn_import_rate_cards_tiered(uuid, jsonb) to authenticated;
