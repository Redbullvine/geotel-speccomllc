-- Admin-safe message cleanup helpers.
-- Main Board cleanup never deletes Direct messages.

create or replace function public.fn_delete_message(p_message_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_org_id uuid;
  v_msg record;
  v_deleted integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select upper(coalesce(nullif(p.role::text, ''), '')), p.org_id
    into v_role, v_org_id
  from public.profiles p
  where p.id = v_uid;

  if v_role is null then
    raise exception 'Profile not found' using errcode = '42501';
  end if;

  select id, org_id, channel, sender_id, recipient_id
    into v_msg
  from public.messages
  where id = p_message_id;

  if not found then
    return 0;
  end if;

  if v_msg.sender_id = v_uid
    or (
      v_msg.channel = 'BOARD'
      and (
        v_role = 'ROOT'
        or (
          v_role in ('OWNER','ADMIN','OFFICE','SUPPORT','PROJECT_MANAGER','PM')
          and v_msg.org_id = v_org_id
        )
      )
    )
  then
    delete from public.messages
    where id = p_message_id;
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end if;

  raise exception 'Not authorized to delete this message' using errcode = '42501';
end;
$$;

create or replace function public.fn_clear_main_board_messages(
  p_org_id uuid default null,
  p_before timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_profile_org_id uuid;
  v_target_org_id uuid;
  v_deleted integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select upper(coalesce(nullif(p.role::text, ''), '')), p.org_id
    into v_role, v_profile_org_id
  from public.profiles p
  where p.id = v_uid;

  if v_role is null then
    raise exception 'Profile not found' using errcode = '42501';
  end if;

  if v_role not in ('ROOT','OWNER','ADMIN','OFFICE','SUPPORT','PROJECT_MANAGER','PM') then
    raise exception 'Not authorized to clear Main Board messages' using errcode = '42501';
  end if;

  v_target_org_id := coalesce(p_org_id, v_profile_org_id);

  if v_role <> 'ROOT' then
    if v_target_org_id is null or v_target_org_id <> v_profile_org_id then
      raise exception 'Not authorized for this organization' using errcode = '42501';
    end if;
  end if;

  delete from public.messages
  where channel = 'BOARD'
    and created_at <= coalesce(p_before, now())
    and (
      (v_role = 'ROOT' and v_target_org_id is null)
      or org_id = v_target_org_id
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.fn_delete_message(uuid) to authenticated;
grant execute on function public.fn_clear_main_board_messages(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
