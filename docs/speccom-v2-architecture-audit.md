# SpecCom V2 Architecture Audit

**Audit date:** 2026-08-26  
**Scope:** repository source and migration history only. The live Supabase
dashboard, deployed functions, database policy catalog, Storage inventory, and
Realtime publication settings still require a read-only production export before
any cutover.

## Executive assessment

The present application is an identity, role, organization, and membership based
system. It is not safe to turn into project-gated V2 by changing the sign-in
screen. The repository includes direct evidence of both project-selection state
and deliberately broad project read access. V2 must run as an additive parallel
access path until data is classified, backed up, project IDs are backfilled, and
isolation tests pass.

## 1. Current access architecture to retire after V2 cutover

| Area | Evidence | V2 disposition |
| --- | --- | --- |
| Supabase password auth and profile bootstrap | `app.js` login/bootstrap and `supabaseClient.js` | Replace for workers with Gateway + opaque project session. Keep Supabase Auth only for owner identities. |
| Mutable selected project | `profiles.current_project_id`; `CURRENT_PROJECT_KEY` and active-project logic in `app.js` | Retire. Session-derived project scope is immutable for its lifetime. |
| Memberships | `public.project_members`, `current_project_role`, migrations throughout `supabase/migrations` | Retire from worker authorization after V2 data migration. |
| Global roles | `profiles.role`, `role_code`, ROOT/admin/project-manager routing and policies | Retire for workers. Replace platform access with `platform_owners` plus strong Supabase Auth MFA. |
| Organization context and invite flow | `orgs`, `profile_invites`, `fn_claim_profile_invite` | Preserve only if it is valuable CRM/project metadata; remove it from worker authorization. |
| Project dashboards/selectors | `loadProjects`, `ProjectsDashboard`, `list-projects` functions, sidebar UI | Remove from normal worker UI. Owner Console is the only project enumerator. |

## 2. Confirmed isolation risks

1. `supabase/migrations/20260629000001_all_projects_visible.sql` and
   `20260629000002_projects_public_read.sql` make project enumeration possible.
2. `20260410000003_ensure_field_photos_bucket_public.sql` makes field-photo
   assets public; knowing a URL can bypass project boundaries.
3. `profiles.current_project_id` is client-selected mutable state, and `app.js`
   loads it into `state.activeProject`; it cannot be an authorization boundary.
4. The main bootstrap loads a global project list and role-dependent workspace.
5. Existing RLS commonly uses `project_members`/role checks rather than a
   session-derived current project. Latest migrations include open-access and
   role-neutral transitions that must be reviewed against the live policy set.
6. Several Storage paths are not canonical `projects/<uuid>/...` paths.
7. Realtime subscriptions include `usage_events` filtered by `node_id`, plus
   live board/location/message channels. Filtering is not a substitute for
   Realtime authorization/RLS.
8. Local/session storage and the offline photo queue are not keyed by immutable
   V2 session/project scope. `clearAuthenticatedWorkspaceState` is useful but
   not an exit-project guarantee today.

## 3. Project-domain data that must survive

Likely project owned: `projects`, `nodes`, `splice_locations`, `sites`,
`site_media`, `site_codes`, `site_entries`, `project_kmz_snapshots`,
`redline_markers`, `field_photos`, `work_orders`, `work_order_events`,
`daily_progress_reports`, `technician_timesheets`, `technician_time_events`,
`usage_events`, `proof_uploads`, `invoices`, `invoice_items`, `invoice_files`,
`material_requirements`, `material_usage`, `inventory_stock`,
`alert_events`, `field_work_location_logs`, and `daily_field_reports`.

These classifications must be confirmed from the live schema and null-rate
report before adding `project_id NOT NULL`; dependent tables may inherit scope
through a parent today and require an explicit backfill.

Shared/platform candidates: `module_registry`, `project_templates`,
`material_catalog`, `unit_types`, and pricing/catalog data. User/workforce data
(`profiles`, `project_members`, `profile_invites`, `user_locations`) is neither
automatically disposable nor automatically project data; it must be retained or
migrated intentionally.

## 4. Current feature/module inventory

The implemented feature set maps to V2 modules: Project Home, Project Map,
Nodes, Sites/locations, Fiber diagram/design, Splicing, Staking/KMZ, Redlines,
Photos/proof, GPS/field visits, Documents/work packages, Work orders/tasks,
Daily reports, Test/diagnostics, Inventory/materials, Billing/invoices,
Messages/live board, Onboarding, and Owner/support tools.

The initial registry is seeded in migration
`20260826000001_speccom_v2_foundation.sql`; it is intentionally industry-neutral
and can grow as the live module audit is completed.

## 5. Recommended V2 security model

Normal workers use the public Gateway only. A server-side endpoint rate-limits
and verifies a cryptographically random Project ID against a stored hash, then
issues a 15–30 minute opaque random token in a `Secure`, `HttpOnly`,
`SameSite=Strict` cookie. The token maps to one immutable project ID in
`project_sessions`; neither localStorage nor a request body chooses the project.

The browser calls only a Backend-for-Frontend (BFF). The BFF validates the
cookie, derives the project ID server-side, verifies module capability, and
performs scoped data operations. Browser direct table access is denied for V2
tables. This avoids creating fake anonymous Auth users, which the V2 brief
prohibits without approval. It also avoids storing service-role credentials in
the browser. The BFF must use allowlisted operations—not generic table/RPC
proxies—and must never accept an authoritative `project_id` from the client.

For owner access, use a separate `/owner` app/route with Supabase Auth, MFA at
AAL2 for all destructive actions, `platform_owners` server-side authorization,
short owner sessions, audit logging, and separate maintenance/preview project
sessions. Owner credentials must never become a worker credential.

Supabase documentation confirms that RLS must be enabled for exposed tables,
Storage policies apply to `storage.objects`, and Realtime uses the access token
for authorization. These controls remain mandatory for all browser-exposed V1
and V2 endpoints; a BFF is an additional boundary, not an excuse to leave
public policies in place.

## 6. Exact migration order

1. Take verified database, Storage, deployment-config, and policy backups.
2. Export the live schema/policies/functions/triggers/publications and inventory
   every table/storage object by project ownership.
3. Apply the additive V2 foundation migration only in a non-production clone.
4. Backfill company/customer/template metadata, project status, and explicit
   `project_id` onto all project-owned tables; quarantine unresolved records.
5. Build the rate-limited Gateway and server-only Project Session BFF.
6. Build project-scoped query/command primitives and module capability checks.
7. Move one feature at a time behind project-scoped policies and canonical
   Storage paths; migrate/copy existing assets without deleting originals.
8. Build project-aware cache/Realtime lifecycle and Exit Project teardown.
9. Build the separately authenticated Owner Console and audit trail.
10. Run automated cross-project database, Storage, Realtime, route, module,
    cache, rotation, revocation, and owner-mode tests.
11. Pilot one non-production project, then cut over production only after
    evidence is captured. Retire V1 authorization in a separate migration.

## 7. Foundation added on `codex/speccom-v2-foundation`

The additive migration adds companies, customers, templates, a central module
registry, project capability manifest, hashed/rotatable access codes, opaque
project sessions, platform owners, and owner audit logging. It adds no public
browser policies and does not delete V1 tables, project records, or files.

## 8. Blockers before destructive implementation

- No production database/Storage policy export is present in the repository.
- The live deployment's functions, secrets, auth configuration, and Realtime
  publications cannot be inferred safely from source alone.
- Every existing project table needs ownership/null/backfill evidence before a
  `NOT NULL project_id` constraint can be safely introduced.
- V1 public project and field-photo access must be removed only during a
  coordinated cutover, after V2 replacement routes are proven.

## 9. Foundation hardening review (2026-08-26)

### Authoritative Project Session and database authorization flow

```
Browser --Project ID--> /api/project-gateway
  -> Gateway normalizes only presentation (uppercase/whitespace), hashes the ID,
     rate-limits a hashed edge client fingerprint, and finds one active code.
  -> Gateway creates a fresh 256-bit random opaque session token, stores only
     SHA-256(token), and sends the raw token solely as a Secure, HttpOnly,
     SameSite=Strict, Path=/api/ cookie.
Browser --cookie--> V2 BFF endpoint
  -> BFF hashes the cookie and validates project_sessions + project status.
  -> BFF derives the sole project UUID; URL/query/body/localStorage values are
     ignored for authority. BFF checks the requested module capability.
  -> BFF mints an at-most-session-lifetime ES256 JWT using a private signing key
     held only in server secrets and imported as an asymmetric Supabase signing
     key. Claims: role=authenticated, access_kind=project_session,
     project_session_id, project_id, sub=session UUID, exp.
  -> BFF calls Supabase with this JWT, never with service_role, for worker data.
Supabase/Postgres
  -> RLS calls public.v2_authorized_project_id(). It compares signed claims to
     project_sessions and projects live state and checks expiry/revocation/status.
  -> policy requires row.project_id = returned project UUID for SELECT/DELETE,
     and the same condition in WITH CHECK for INSERT/UPDATE.
  -> only the matching project row can return.
```

This is one authoritative model, not two partial models. The opaque cookie is
the browser-to-BFF credential. The server-minted asymmetric JWT is a short-lived
BFF-to-Supabase credential. `service_role` is reserved only for narrowly
allowlisted setup/maintenance operations and must never serve normal worker data.
Supabase currently supports externally minted JWTs through an imported signing
key; its documentation requires a short expiration and an existing Postgres role.

The implementation presently includes Gateway/Exit and the RLS bridge function;
the project-scoped data BFF and per-table RLS policies are intentionally not yet
built because ownership backfills have not been approved. Therefore V2 is **not
yet a usable replacement path** and must not be cut over.

### Session/cookie assessment

| Control | Foundation status |
| --- | --- |
| Unforgeable session | 32 bytes from `crypto.randomBytes`; only SHA-256 is persisted. |
| Fixation | Gateway always creates a new token and does not adopt a supplied session identifier. |
| Expiry/revocation | Checked in BFF validation and again by the RLS bridge. |
| Project disable/archive | `v2_status = active` is checked at Gateway, BFF, and RLS bridge. |
| Project-ID rotation | access-code rows have active/revoked state and replacement lineage. Rotation must revoke the old code and all sessions created with it atomically. |
| Cookie flags | Secure, HttpOnly, SameSite=Strict, `/api/` path; production HTTPS is mandatory. |
| Logging | Gateway never logs the entered Project ID or raw session token. |
| Abuse control | Prepared atomic fixed-window server-side limit: 8 attempts per hashed edge fingerprint / five minutes. Before production, add edge/WAF limiting and monitoring because function-level counters alone are not sufficient DDoS protection. |

### Direct browser Supabase audit

**Verdict: the existing V1 frontend bypasses V2 today.** `supabaseClient.js`
creates a browser client, and `app.js` makes direct table, RPC, Storage, Auth,
and Realtime calls with it. The V2 HttpOnly cookie does not protect these calls.
No existing direct worker data call may remain direct after V2 cutover because it
carries a V1 Supabase Auth token, not the BFF-minted V2 project JWT.

| Source | Direct access | V2 disposition |
| --- | --- | --- |
| `supabaseClient.js` | `createClient`, Auth session persistence | Owner-only client may remain in a separate Owner Console bundle; remove from worker bundle. |
| `app.js` | `projects`, `project_members`, `profiles`, `orgs`, `sites`, `site_codes`, `site_entries`, `site_media`, `nodes`, `splice_locations`, `redline_markers`, `field_photos`, `project_kmz_snapshots` | Convert all worker operations to the project BFF. No direct browser access. |
| `app.js` | Work: `work_orders`, `work_order_events`, `daily_progress_reports`, field-day/time/location tables, `messages`, `user_locations` | Convert to BFF and explicit V2 project scope. Worker identity features are deferred/project-local. |
| `app.js` | Billing/materials: invoices, invoice items/files, rate cards, usage, inventory, alerts, proof uploads | Convert each worker-facing operation to a module-gated BFF endpoint. Shared catalog data requires separate read policy, never project data. |
| `app.js` | RPCs: `fn_*`, `create_owner_override`, `node_proof_status` | Every legacy RPC is blocked from the worker bundle. Replace selectively with BFF commands whose scope is derived from the session; do not proxy arbitrary RPC names. |
| `app.js` | Storage: `field-photos`, `proof-photos`, `work-packages`, profile images, subcontractor docs | Project assets must use BFF-issued short-lived signed URLs restricted to `projects/<uuid>/...`; non-project owner/profile artifacts need a separate design. |
| `app.js` | Realtime channels: messages, usage events, live board, team locations, presence | Remove until a V2 JWT/RLS Realtime channel design is implemented and tested. Filter strings alone are not authorization. |
| `workspaces/field-photos.html` | Direct projects, field photos, and Storage calls | Retire or rewrite behind the project BFF before V2 enablement. |

The exact direct table and bucket inventory is: `alert_subscriptions`, `alerts`,
`allowed_quantities`, `daily_progress_reports`, `field_day_*`,
`field_location_pings`, `field_photos`, `invoices`, `invoice_*`,
`ks_invoice_*`, `material_*`, `messages`, `node_inventory`, `nodes`, `orgs`,
`owner_overrides`, `profiles`, `project_members`, `projects`, `proof_uploads`,
`rate_cards`, `redline_markers`, `site_*`, `splice_*`, `technician_*`,
`usage_events`, `user_locations`, `work_orders`, and their related Storage
buckets. This is a conversion inventory, not a claim that every table is
project-owned.

### Known broad policies and grants to remove at cutover

Repository evidence identifies these active-or-potentially-active policies:

| Migration | Policy/grant | Risk |
| --- | --- | --- |
| `20260629000001_all_projects_visible.sql` | `projects_select_all_authenticated` | Any authenticated user can enumerate projects. |
| `20260629000002_projects_public_read.sql` | `public_read` on projects, sites, site codes/media, field photos, nodes, splice locations/photos; grants to `anon`, `authenticated` | Direct public project and asset metadata read. |
| same | `proof_and_field_photos_public_read` on `storage.objects` | Public access to known photo paths. |
| `20260410000002_field_photos.sql`, `20260410000003_ensure_field_photos_bucket_public.sql` | bucket `field-photos` public; `field_photos_public_read`; broad authenticated writes | Any public URL can read and authenticated users can write arbitrary paths. |
| `20260702000002_open_project_work_access.sql` | `has_project_access`, `fn_material_has_project_access`, `field_photos_*_authenticated` | Any signed-in user has access to any existing project. |
| `20260424000001_role_free_kmz_imports.sql` | `project_kmz_snapshots_*_authenticated` | Any authenticated user can access project KMZ snapshots. |
| 20260701 field-work migrations | `*_read_authenticated` | Project field data becomes visible to all authenticated users. |

The prepared, deliberately unapplied removal plan is
`docs/sql/speccom-v2-cutover-security-removal.sql`.

### Storage design and migration rule

`field-photos` is presently public and `app.js` calls `getPublicUrl`; this is an
absolute V2 isolation failure. Existing objects are preserved. A migration job
will inventory every object, determine its project through its database parent,
copy it to `projects/<project-uuid>/photos/<object>`, update the owning DB row
in one transactionally recoverable workflow, and retain the original until
verification. The bucket then becomes private; the BFF issues only short-lived
signed URLs after deriving the project from the session. No client-supplied
object path is accepted.

### Owner boundary

Owner users authenticate only through Supabase Auth in `/owner`, with MFA AAL2
required for project code rotation, archive/restore, data repair, and owner
maintenance sessions. The BFF verifies both the Auth token and active
`platform_owners` row, then records the action. It may mint either
`owner_preview` or `owner_maintenance` project JWTs scoped to exactly one
project. Worker sessions lack an Owner Auth identity and cannot call or mint
owner endpoints. Service keys and project-JWT private keys remain server-only.

### Module enforcement

Navigation hides disabled modules, routing rejects them, and every BFF endpoint
maps to one registry key. The BFF checks `project_modules.enabled` before it
mints/uses the database token for that operation. Database policies enforce
project ownership; capability enforcement stops disabled-but-same-project
features. A manual `/fiber-art` route or JSON `module=fiber_art` is therefore
rejected without loading data.

### Data migration map (repository-only; live schema confirmation required)

| Old table/group | V2 destination | Project ID source | Migration method | Risk | Status |
| --- | --- | --- | --- | --- | --- |
| `projects` | canonical `projects` | existing `id` | enrich in place with V2 metadata | low | ready for inventory |
| nodes, splice locations, sites, field photos, KMZ, redlines | same tables with `project_id NOT NULL` | existing/parent project relation | backfill + foreign-key validation | null/parent gaps | audit required |
| site codes/media/entries, splice photos | same tables with explicit `project_id` | parent site/splice record | join-backfill then constraint | orphaned parent | audit required |
| work orders/events, daily reports, field-day, time, location logs | same tables with `project_id NOT NULL` | existing project column or parent work record | validate then backfill | user/role coupling | audit required |
| invoices/items/files, rate cards, materials/inventory/usage/alerts | project tables plus shared catalogs | existing project or parent invoice/item | classify first; backfill owned records only | shared vs project ambiguity | audit required |
| messages, user locations, profiles, memberships, invites | project-local replacement or retained platform data | no automatic source | preserve separately; do not bulk tag | identity data is not project data | blocked pending product decision |
| Storage objects | `projects/<uuid>/...` private objects | owning DB record | copy, verify hash/count, update reference, retain old copy | missing linkage/public URLs | audit required |

### V2 test scope and present limit

`tests/v2ProjectSecurity.test.mjs` contains source-level adversarial coverage
for ID normalization/invalid format, expired/revoked/disabled sessions,
Project-A scope despite Project-B URL/body/storage manipulation, module gating,
cookie flags, control-table privilege posture, prepared public-policy removal,
and detection of the unresolved direct V1 bypass.

It does **not** prove live Supabase RLS, Storage, or Realtime yet because the
migration is deliberately unapplied. Those tests must run against an isolated
staging database with two seeded projects before authorization cutover.
