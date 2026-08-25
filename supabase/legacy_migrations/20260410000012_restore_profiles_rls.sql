-- Restore RLS on the profiles table with role-aware policies.
-- The reset migration (20260315000001) disabled all RLS. This restores
-- sensible defaults: own row, org-scoped for ADMIN, platform-wide for ROOT.

alter table public.profiles enable row level security;

-- Drop any existing policies first for a clean slate
drop policy if exists "profiles_read_own"          on public.profiles;
drop policy if exists "profiles_root_read_all"     on public.profiles;
drop policy if exists "profiles_admin_read_org"    on public.profiles;
drop policy if exists "profiles_root_update"       on public.profiles;
drop policy if exists "profiles_admin_update_org"  on public.profiles;
drop policy if exists "profiles_insert_self"       on public.profiles;

-- Users can always read their own row
create policy "profiles_read_own" on public.profiles
  for select using (id = auth.uid());

-- ROOT can read all profiles across all orgs
create policy "profiles_root_read_all" on public.profiles
  for select using (
    exists (
      select 1 from public.profiles p2
      where p2.id = auth.uid() and p2.role = 'ROOT'
    )
  );

-- ADMIN/OWNER can read profiles within their own org
create policy "profiles_admin_read_org" on public.profiles
  for select using (
    org_id is not null
    and org_id = (select p3.org_id from public.profiles p3 where p3.id = auth.uid())
    and exists (
      select 1 from public.profiles p4
      where p4.id = auth.uid() and p4.role in ('ROOT','ADMIN','OWNER')
    )
  );

-- ROOT can update any profile (including role and org_id)
create policy "profiles_root_update" on public.profiles
  for update using (
    exists (
      select 1 from public.profiles p2
      where p2.id = auth.uid() and p2.role = 'ROOT'
    )
  );

-- ADMIN/OWNER can update profiles in their org, but cannot assign ROOT role
create policy "profiles_admin_update_org" on public.profiles
  for update using (
    org_id = (select p3.org_id from public.profiles p3 where p3.id = auth.uid())
    and exists (
      select 1 from public.profiles p4
      where p4.id = auth.uid() and p4.role in ('ROOT','ADMIN','OWNER')
    )
  )
  with check (role != 'ROOT');

-- Users can update their own non-sensitive fields (display_name, preferred_language, avatar_url, current_project_id)
-- Role and org_id changes are blocked at the app layer for non-admins
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid())
  with check (
    -- Prevent self-role escalation (enforced at app layer too)
    role = (select p5.role from public.profiles p5 where p5.id = auth.uid())
    or exists (
      select 1 from public.profiles p6
      where p6.id = auth.uid() and p6.role in ('ROOT','ADMIN','OWNER')
    )
  );

-- Users can insert their own profile row on first login (auth trigger fallback)
create policy "profiles_insert_self" on public.profiles
  for insert with check (id = auth.uid());

notify pgrst, 'reload schema';
