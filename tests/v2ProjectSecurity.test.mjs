import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  isValidProjectCodeFormat,
  moduleIsEnabled,
  normalizeProjectCode,
  projectScopeForRequest,
  secureSessionCookie,
  sessionIsUsable,
} from "../services/v2/projectSecurity.mjs";

const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";
const activeProject = { v2_status: "active" };

function workerSession(overrides = {}) {
  return {
    project_id: projectA,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
    mode: "worker",
    ...overrides,
  };
}

test("V2 Gateway normalizes a field-friendly Project ID without accepting malformed values", () => {
  assert.equal(normalizeProjectCode(" sc-r54-x7m4-k92p-d8qt "), "SC-R54-X7M4-K92P-D8QT");
  assert.equal(isValidProjectCodeFormat("SC-R54-X7M4-K92P-D8QT"), true);
  assert.equal(isValidProjectCodeFormat("PROJECT1"), false);
  assert.equal(isValidProjectCodeFormat("SC-R54-X7M4-K92P-D8QO"), false);
});

test("an expired or revoked Project Session is denied server-side", () => {
  assert.equal(sessionIsUsable(workerSession({ expires_at: new Date(Date.now() - 1).toISOString() }), activeProject), false);
  assert.equal(sessionIsUsable(workerSession({ revoked_at: new Date().toISOString() }), activeProject), false);
});

test("a disabled or archived project invalidates an otherwise valid session", () => {
  assert.equal(sessionIsUsable(workerSession(), { v2_status: "suspended" }), false);
  assert.equal(sessionIsUsable(workerSession(), { v2_status: "archived" }), false);
});

test("Project A scope ignores a submitted Project B ID", () => {
  assert.equal(projectScopeForRequest(workerSession(), projectB), projectA);
});

test("Project A never receives Project B scope after URL, JSON, storage, or JavaScript manipulation", () => {
  for (const attackerControlledValue of [projectB, "?project_id=" + projectB, JSON.stringify({ project_id: projectB }), null]) {
    assert.equal(projectScopeForRequest(workerSession(), attackerControlledValue), projectA);
  }
});

test("a missing or invalid session produces no project scope", () => {
  assert.equal(projectScopeForRequest(null, projectB), null);
  assert.equal(projectScopeForRequest(workerSession({ revoked_at: new Date().toISOString() }), projectB), null);
});

test("disabled modules are rejected by the server capability guard", () => {
  assert.equal(moduleIsEnabled(["dashboard", "tasks"], "tasks"), true);
  assert.equal(moduleIsEnabled(["dashboard", "tasks"], "fiber_art"), false);
});

test("Project Session cookies are secure, HttpOnly, SameSite strict, and API-scoped", () => {
  const value = secureSessionCookie("speccom_project_session", "random", 1200);
  assert.match(value, /Path=\/api\//);
  assert.match(value, /HttpOnly/);
  assert.match(value, /Secure/);
  assert.match(value, /SameSite=Strict/);
  assert.doesNotMatch(value, /project_id/i);
});

test("V2 foundation keeps its control tables unreachable from browser roles", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20260826000001_speccom_v2_foundation.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on public\.companies[\s\S]+from anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.v2_validate_project_session\(text\) from public, anon, authenticated;/);
  assert.match(sql, /create or replace function public\.v2_authorized_project_id\(\)/);
  assert.match(sql, /ps\.revoked_at is null/);
  assert.match(sql, /grant execute on function public\.v2_authorized_project_id\(\) to authenticated;/);
  assert.match(sql, /revoke all on function public\.v2_consume_gateway_attempt\(text\) from public, anon, authenticated;/);
});

test("the prepared cutover removes known public project and photo read paths", () => {
  const sql = fs.readFileSync(new URL("../docs/sql/speccom-v2-cutover-security-removal.sql", import.meta.url), "utf8");
  assert.match(sql, /'projects', 'sites', 'site_codes', 'site_media', 'field_photos'/);
  assert.match(sql, /'projects_select_all_authenticated'/);
  assert.match(sql, /set public = false/);
  assert.match(sql, /drop policy if exists "field_photos_public_read"/);
});

test("the legacy frontend is positively identified as a direct Supabase bypass until conversion", () => {
  const legacyApp = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(legacyApp, /state\.client\.from\("projects"\)/);
  assert.match(legacyApp, /\.storage\s*\.from\("field-photos"\)/);
  assert.match(legacyApp, /\.channel\("message-notifications"\)/);
});
