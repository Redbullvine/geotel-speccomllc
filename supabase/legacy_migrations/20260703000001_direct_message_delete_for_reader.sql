-- Direct messages can be deleted from each participant's own view after read.
-- Board messages keep their existing sender/admin cleanup behavior.

alter table if exists public.messages
  add column if not exists sender_deleted_at timestamptz null,
  add column if not exists recipient_deleted_at timestamptz null;

create index if not exists messages_dm_sender_visible_idx
  on public.messages (sender_id, created_at desc)
  where channel = 'DM' and sender_deleted_at is null;

create index if not exists messages_dm_recipient_visible_idx
  on public.messages (recipient_id, created_at desc)
  where channel = 'DM' and recipient_deleted_at is null;

create or replace function public.fn_delete_message(p_message_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
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

  select id,
         org_id,
         channel,
         sender_id,
         recipient_id,
         sender_deleted_at,
         recipient_deleted_at
    into v_msg
  from public.messages
  where id = p_message_id;

  if not found then
    return 0;
  end if;

  if v_msg.channel = 'DM' then
    if v_msg.sender_id = v_uid then
      update public.messages
      set sender_deleted_at = coalesce(sender_deleted_at, now())
      where id = p_message_id;
      get diagnostics v_deleted = row_count;

      delete from public.messages
      where id = p_message_id
        and sender_deleted_at is not null
        and recipient_deleted_at is not null;

      return greatest(v_deleted, 1);
    elsif v_msg.recipient_id = v_uid then
      update public.messages
      set recipient_deleted_at = coalesce(recipient_deleted_at, now())
      where id = p_message_id;
      get diagnostics v_deleted = row_count;

      delete from public.messages
      where id = p_message_id
        and sender_deleted_at is not null
        and recipient_deleted_at is not null;

      return greatest(v_deleted, 1);
    elsif v_role = 'ROOT' then
      delete from public.messages
      where id = p_message_id;
      get diagnostics v_deleted = row_count;
      return v_deleted;
    end if;
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

grant execute on function public.fn_delete_message(uuid) to authenticated;

drop policy if exists "messages_select_project_members" on public.messages;
drop policy if exists "messages_select_org" on public.messages;
create policy "messages_select_org"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        upper(coalesce(p.role::text, '')) = 'ROOT'
        or lower(coalesce(auth.jwt() ->> 'email', '')) = 'support@fatanett.com'
        or (
          org_id = p.org_id
          and (
            channel = 'BOARD'
            or (
              channel = 'DM'
              and (
                (sender_id = auth.uid() and sender_deleted_at is null)
                or (recipient_id = auth.uid() and recipient_deleted_at is null)
              )
            )
          )
        )
      )
  )
);

drop policy if exists "messages_delete" on public.messages;
drop policy if exists "messages_delete_org" on public.messages;
drop policy if exists "messages_delete_sender" on public.messages;
create policy "messages_delete"
on public.messages
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        upper(coalesce(p.role::text, '')) = 'ROOT'
        or lower(coalesce(auth.jwt() ->> 'email', '')) = 'support@fatanett.com'
        or (
          channel = 'BOARD'
          and org_id = p.org_id
          and (
            sender_id = auth.uid()
            or upper(coalesce(p.role::text, '')) in ('OWNER','ADMIN','OFFICE','SUPPORT','PROJECT_MANAGER','PM')
          )
        )
      )
  )
);

notify pgrst, 'reload schema';
