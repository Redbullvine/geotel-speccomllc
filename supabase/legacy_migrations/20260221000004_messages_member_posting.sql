-- Messages board posting for all authenticated org members (company-scoped)

drop policy if exists "messages_insert_org" on public.messages;

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
        )
      )
  )
);

notify pgrst, 'reload schema';