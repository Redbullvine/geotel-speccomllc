-- Fix 1: fn_clear_main_board_messages — ROOT can delete any BOARD message
--   The original condition (ROOT AND v_target_org_id IS NULL) required a null org
--   to clear across all orgs. JS always passes the caller's org_id, so ROOT never
--   matched messages belonging to other orgs. Change to: ROOT bypasses org check.
--
-- Fix 2: Add a DELETE RLS policy on messages so the fallback direct-delete path
--   works when the RPC is unavailable or returns 0.

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
      v_role = 'ROOT'
      or org_id = v_target_org_id
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.fn_clear_main_board_messages(uuid, timestamptz) to authenticated;

-- Add messages DELETE policy so fallback direct-delete calls work.
-- Mirrors the authorization logic in fn_delete_message.
drop policy if exists "messages_delete" on public.messages;
drop policy if exists "messages_delete_org" on public.messages;

create policy "messages_delete"
on public.messages for delete
to authenticated
using (
  sender_id = auth.uid()
  or (
    channel = 'BOARD'
    and (
      my_role() = 'root'
      or (
        my_role() in ('owner','admin','office','support','project_manager','pm')
        and org_id = my_org_id()
      )
    )
  )
);

notify pgrst, 'reload schema';
