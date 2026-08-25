-- Backfill missing profile org assignments from existing project memberships

with member_org as (
  select
    pm.user_id,
    min(pr.org_id::text)::uuid as org_id
  from public.project_members pm
  join public.projects pr on pr.id = pm.project_id
  where pr.org_id is not null
  group by pm.user_id
)
update public.profiles p
set org_id = m.org_id
from member_org m
where p.id = m.user_id
  and p.org_id is null;

notify pgrst, 'reload schema';
