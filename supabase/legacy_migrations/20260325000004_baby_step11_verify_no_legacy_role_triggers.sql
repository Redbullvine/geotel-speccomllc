do $$
declare
  bad_triggers text;
begin
  select string_agg(format('%I.%I -> %I()', n.nspname, c.relname, p.proname), ', ')
    into bad_triggers
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal
    and (
      pg_get_functiondef(p.oid) ilike '%NEW.role%'
      or pg_get_functiondef(p.oid) ilike '%OLD.role%'
      or pg_get_functiondef(p.oid) ilike '%NEW.role_code%'
      or pg_get_functiondef(p.oid) ilike '%OLD.role_code%'
    );

  if bad_triggers is not null then
    raise exception 'Legacy role trigger references still active: %', bad_triggers;
  end if;
end
$$;
