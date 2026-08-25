-- Persist last selected project on profile
alter table public.profiles
  add column if not exists current_project_id uuid;

create index if not exists profiles_current_project_idx on public.profiles(current_project_id);

-- Allow users to update their own profile (including current_project_id)
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);
