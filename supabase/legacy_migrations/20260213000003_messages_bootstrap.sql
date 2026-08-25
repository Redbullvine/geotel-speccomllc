create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid references public.projects(id) on delete cascade,
  org_id uuid null,
  sender_id uuid not null references auth.users(id),
  recipient_id uuid null references auth.users(id),
  body text not null,
  priority int not null default 0,
  is_read boolean not null default false
);

alter table public.messages
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists org_id uuid null,
  add column if not exists sender_id uuid references auth.users(id),
  add column if not exists recipient_id uuid null references auth.users(id),
  add column if not exists body text,
  add column if not exists priority int not null default 0,
  add column if not exists is_read boolean not null default false;

alter table public.messages
  alter column sender_id set not null,
  alter column body set not null;

create index if not exists messages_project_id_idx on public.messages(project_id);
create index if not exists messages_recipient_id_idx on public.messages(recipient_id);
create index if not exists messages_created_at_idx on public.messages(created_at desc);

alter table public.messages enable row level security;

drop policy if exists "messages_select_project_members" on public.messages;
create policy "messages_select_project_members"
on public.messages for select
to authenticated
using (
  sender_id = auth.uid()
  or recipient_id = auth.uid()
  or (
    project_id is null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
    )
  )
  or exists (
    select 1 from public.project_members pm
    where pm.project_id = project_id and pm.user_id = auth.uid()
  )
);

drop policy if exists "messages_insert_project_members" on public.messages;
create policy "messages_insert_project_members"
on public.messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and (
    (
      project_id is null
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and public.effective_role_code(p.role_code, p.role) in ('ROOT','SUPPORT')
      )
    )
    or exists (
      select 1 from public.project_members pm
      where pm.project_id = project_id and pm.user_id = auth.uid()
    )
  )
);

drop policy if exists "messages_update_sender" on public.messages;
create policy "messages_update_sender"
on public.messages for update
to authenticated
using (sender_id = auth.uid())
with check (sender_id = auth.uid());

drop policy if exists "messages_delete_sender" on public.messages;
create policy "messages_delete_sender"
on public.messages for delete
to authenticated
using (sender_id = auth.uid());

notify pgrst, 'reload schema';
