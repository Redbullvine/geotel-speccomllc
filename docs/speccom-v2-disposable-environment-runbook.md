# SpecCom V2 disposable isolation runbook

This package must run only in a newly created, explicitly named disposable
Supabase project. It must never link to `speccomllc`, shared staging, production,
or any telecomengine project.

1. Create a new Supabase project named `speccom-v2-isolation-disposable`.
2. Generate an ES256 key with `supabase gen signing-key --algorithm ES256`; import
   the private JWK as a Supabase signing key, activate it, and retain the private
   JWK only in the disposable test runner/server secret store.
3. Apply only `20260826000001_speccom_v2_foundation.sql` and
   `20260826000002_v2_disposable_isolation_fixtures.sql` to that project.
4. Export these process-only values: `V2_DISPOSABLE_SUPABASE_URL`,
   `V2_DISPOSABLE_SUPABASE_PUBLISHABLE_KEY`,
   `V2_DISPOSABLE_SUPABASE_SERVICE_ROLE_KEY`, `V2_PROJECT_JWT_PRIVATE_JWK`, and
   `V2_PROJECT_JWT_KID`; set `V2_RUN_DISPOSABLE_INTEGRATION=1`.
5. Run `node --test tests/v2Isolation.integration.test.mjs`.

The integration suite creates fake ALPHA/BRAVO projects and deletes them at the
end. It directly calls Supabase using each controlled server-minted JWT, proving
RLS rather than relying on BFF mocks. Storage/realtime integration is deliberately
blocked until this suite and signed-key setup are available.

V2 Realtime decision: use polling/BFF-mediated events for the first worker
release. Do not give the browser a project JWT or reuse legacy Realtime channels.
