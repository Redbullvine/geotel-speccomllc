# V2 project isolation boundary

Only V2 BFF endpoints may import this directory. `projectSession` is the sole
cookie authority. `projectSupabaseClient` mints a two-minute ES256 JWT and uses
it as the Supabase access token; it never uses a service-role key. PostgreSQL
must enforce `project_id = public.v2_authorized_project_id()` for every worker
table.

The service-role key is permitted only in `projectSession` (opaque-session
lookup), the Gateway (credential exchange/rate limit), and future separately
authorized owner/setup jobs. It is prohibited in `projectData` handlers.

