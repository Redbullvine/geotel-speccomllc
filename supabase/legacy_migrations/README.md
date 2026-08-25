# Legacy migrations (pre-flat-schema)

These are the migrations for the **previous** Supabase project, which was built
around orgs/tenants, an `app_role` enum, `project_members`, and per-role RLS
policies.

They are kept for historical reference only. They are **not** part of the
migration chain for the current project (`sgrxziinfvwswjlrhzqu`) and must not be
run against it — they would recreate exactly the roles/permissions/tenants
machinery the flat schema removes.

The live schema starts from `supabase/migrations/20260825000000_flat_schema_baseline.sql`.
