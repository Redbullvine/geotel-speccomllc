create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id),
  user_name text,
  scope text not null default 'company',
  body text not null default '',
  pinned boolean not null default false
);

alter table public.messages
  add column if not exists user_id uuid references auth.users(id),
  add column if not exists user_name text,
  add column if not exists scope text not null default 'company',
  add column if not exists pinned boolean not null default false;

update public.messages
set user_id = sender_id
where user_id is null
  and sender_id is not null;

update public.messages m
set user_name = coalesce(nullif(p.display_name, ''), user_name, 'User')
from public.profiles p
where m.user_name is null
  and p.id = m.user_id;

update public.messages
set scope = case
  when channel = 'DM' then 'personal'
  else 'company'
end
where scope is null
   or scope not in ('company','personal');

alter table public.messages
  drop constraint if exists messages_scope_check;

alter table public.messages
  add constraint messages_scope_check
  check (scope in ('company','personal'));

create index if not exists messages_scope_created_idx
  on public.messages (scope, created_at desc);

create index if not exists messages_scope_user_created_idx
  on public.messages (scope, user_id, created_at desc);

notify pgrst, 'reload schema';