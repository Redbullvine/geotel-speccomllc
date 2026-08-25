create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  message_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_project_id_idx on public.messages(project_id);
create index if not exists messages_created_at_idx on public.messages(created_at desc);

alter table public.messages enable row level security;

drop policy if exists "messages_select_project_members" on public.messages;
create policy "messages_select_project_members"
on public.messages for select
to authenticated
using (
  project_id is null
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
    project_id is null
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
