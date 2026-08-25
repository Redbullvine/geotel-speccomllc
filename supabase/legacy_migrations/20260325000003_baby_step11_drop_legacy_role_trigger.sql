-- Baby Step 1.1: permanently remove leftover legacy role-change trigger logic
drop trigger if exists trg_prevent_role_change on public.profiles;
drop function if exists public.prevent_role_change();
