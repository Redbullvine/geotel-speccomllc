-- Org-only Main Board + DMs
-- ROOT remains global bypass.

alter table public.messages
  add column if not exists org_id uuid,
  add column if not exists channel text not null default 'DM',
  add column if not exists sender_id uuid references auth.users(id),
  add column if not exists recipient_id uuid null references auth.users(id),
  add column if not exists body text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'project_id'
  ) then
    execute '
      update public.messages m
      set org_id = coalesce(
        m.org_id,
        (select p.org_id from public.profiles p where p.id = m.sender_id),
        (select pr.org_id from public.projects pr where pr.id = m.project_id),
        (select r.org_id from public.profiles r where r.id = m.recipient_id)
      )
      where m.org_id is null
    ';
  else
    execute '
      update public.messages m
      set org_id = coalesce(
        m.org_id,
        (select p.org_id from public.profiles p where p.id = m.sender_id),
        (select r.org_id from public.profiles r where r.id = m.recipient_id)
      )
      where m.org_id is null
    ';
  end if;
end $$;

alter table public.messages
  alter column org_id set not null,
  alter column sender_id set not null,
  alter column body set not null;

update public.messages
set channel = case
  when recipient_id is null then 'BOARD'
  else 'DM'
end
where channel not in ('DM', 'BOARD')
   or (recipient_id is null and channel <> 'BOARD')
   or (recipient_id is not null and channel <> 'DM');

alter table public.messages
  drop constraint if exists messages_channel_check;

alter table public.messages
  add constraint messages_channel_check
  check (channel in ('DM','BOARD'));

alter table public.messages
  drop constraint if exists messages_channel_recipient_check;

alter table public.messages
  add constraint messages_channel_recipient_check
  check (
    (channel = 'DM' and recipient_id is not null)
    or (channel = 'BOARD' and recipient_id is null)
  );

create index if not exists messages_org_channel_created_idx
  on public.messages (org_id, channel, created_at desc);

create index if not exists messages_org_recipient_created_idx
  on public.messages (org_id, recipient_id, created_at desc);

create index if not exists messages_org_sender_created_idx
  on public.messages (org_id, sender_id, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "messages_select_project_members" on public.messages;
drop policy if exists "messages_insert_project_members" on public.messages;
drop policy if exists "messages_update_sender" on public.messages;
drop policy if exists "messages_delete_sender" on public.messages;
drop policy if exists "messages_select_org" on public.messages;
drop policy if exists "messages_insert_org" on public.messages;
drop policy if exists "messages_delete_org" on public.messages;

create policy "messages_select_org"
on public.messages for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          org_id = p.org_id
          and (
            channel = 'BOARD'
            or (
              channel = 'DM'
              and (sender_id = auth.uid() or recipient_id = auth.uid())
            )
          )
        )
      )
  )
);

create policy "messages_insert_org"
on public.messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or org_id = p.org_id
      )
      and (
        (
          channel = 'DM'
          and recipient_id is not null
          and exists (
            select 1
            from public.profiles rp
            where rp.id = recipient_id
              and (
                public.effective_role_code(p.role_code, p.role) = 'ROOT'
                or rp.org_id = org_id
              )
          )
        )
        or (
          channel = 'BOARD'
          and recipient_id is null
          and public.effective_role_code(p.role_code, p.role) in (
            'OWNER','ADMIN','PROJECT_MANAGER','PM','SUPPORT','ROOT'
          )
        )
      )
  )
);

create policy "messages_delete_org"
on public.messages for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        public.effective_role_code(p.role_code, p.role) = 'ROOT'
        or (
          org_id = p.org_id
          and sender_id = auth.uid()
        )
      )
  )
);

notify pgrst, 'reload schema';
