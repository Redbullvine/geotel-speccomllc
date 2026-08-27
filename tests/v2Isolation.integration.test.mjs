// Runs only against an explicitly designated disposable Supabase environment.
// It never falls back to the linked/shared SpecCom project.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

const enabled = process.env.V2_RUN_DISPOSABLE_INTEGRATION === "1";
const url = process.env.V2_DISPOSABLE_SUPABASE_URL;
const serviceKey = process.env.V2_DISPOSABLE_SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.V2_DISPOSABLE_SUPABASE_PUBLISHABLE_KEY;
const require = createRequire(import.meta.url);
const { mintProjectJwt } = require("../server/v2/projectJwt");

if (!enabled || !url || !serviceKey || !publishableKey) {
  test("V2 disposable RLS integration suite requires an explicit isolated environment", { skip: true }, () => {});
} else {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const nonce = crypto.randomUUID().slice(0, 8);
  const state = {};
  const tokenHash = () => crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
  const projectClient = (context) => createClient(url, publishableKey, { auth: { persistSession: false }, accessToken: async () => mintProjectJwt(context) });

  test("seed ALPHA and BRAVO only in the disposable project", async () => {
    const { data: projects, error } = await admin.from("projects").insert([
      { name: `V2 ALPHA ${nonce}`, v2_status: "active" },
      { name: `V2 BRAVO ${nonce}`, v2_status: "active" },
    ]).select("id,name");
    assert.ifError(error);
    state.alpha = projects.find((p) => p.name.includes("ALPHA")).id;
    state.bravo = projects.find((p) => p.name.includes("BRAVO")).id;
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { data: sessions, error: sessionError } = await admin.from("project_sessions").insert([
      { project_id: state.alpha, token_hash: tokenHash(), expires_at: expiresAt, mode: "worker" },
      { project_id: state.bravo, token_hash: tokenHash(), expires_at: expiresAt, mode: "worker" },
    ]).select("id,project_id,expires_at");
    assert.ifError(sessionError);
    state.alphaContext = { sessionId: sessions.find((s) => s.project_id === state.alpha).id, projectId: state.alpha, expiresAt };
    state.bravoContext = { sessionId: sessions.find((s) => s.project_id === state.bravo).id, projectId: state.bravo, expiresAt };
    assert.ifError((await admin.from("v2_test_records").insert([
      { project_id: state.alpha, name: "ALPHA-001" }, { project_id: state.bravo, name: "BRAVO-001" },
    ])).error);
  });

  test("direct REST/JWT RLS permits only the JWT project and blocks cross-project CRUD", async () => {
    const alpha = projectClient(state.alphaContext);
    const bravo = projectClient(state.bravoContext);
    const { data: alphaRows, error: alphaError } = await alpha.from("v2_test_records").select("project_id,name");
    assert.ifError(alphaError); assert.deepEqual(alphaRows.map((r) => r.name), ["ALPHA-001"]);
    const { data: bravoRows, error: bravoError } = await bravo.from("v2_test_records").select("project_id,name");
    assert.ifError(bravoError); assert.deepEqual(bravoRows.map((r) => r.name), ["BRAVO-001"]);
    const alphaRecord = alphaRows[0];
    const bravoId = bravoRows[0].project_id;
    assert.ok((await alpha.from("v2_test_records").select().eq("project_id", bravoId)).data.length === 0);
    assert.ok((await alpha.from("v2_test_records").insert({ project_id: bravoId, name: "ATTACK" })).error);
    assert.ok((await alpha.from("v2_test_records").update({ project_id: bravoId }).eq("id", alphaRecord.id)).error);
    assert.equal((await alpha.from("v2_test_records").delete().eq("project_id", bravoId).select()).data.length, 0);
  });

  test("a valid JWT stops working immediately after live revocation or project suspension", async () => {
    const alpha = projectClient(state.alphaContext);
    assert.ifError((await admin.from("project_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", state.alphaContext.sessionId)).error);
    assert.equal((await alpha.from("v2_test_records").select()).data.length, 0);
    assert.ifError((await admin.from("project_sessions").update({ revoked_at: null }).eq("id", state.alphaContext.sessionId)).error);
    assert.ifError((await admin.from("projects").update({ v2_status: "suspended" }).eq("id", state.alpha)).error);
    assert.equal((await alpha.from("v2_test_records").select()).data.length, 0);
    assert.ifError((await admin.from("projects").update({ v2_status: "active" }).eq("id", state.alpha)).error);
  });

  test("private Storage enforces the same ALPHA/BRAVO boundary even for a known path", async () => {
    const alphaPath = `projects/${state.alpha}/ALPHA-PHOTO.txt`;
    const bravoPath = `projects/${state.bravo}/BRAVO-PHOTO.txt`;
    assert.ifError((await admin.storage.from("v2-isolation-test").upload(alphaPath, "ALPHA", { upsert: true })).error);
    assert.ifError((await admin.storage.from("v2-isolation-test").upload(bravoPath, "BRAVO", { upsert: true })).error);
    const alpha = projectClient(state.alphaContext);
    assert.ifError((await alpha.storage.from("v2-isolation-test").download(alphaPath)).error);
    assert.ok((await alpha.storage.from("v2-isolation-test").download(bravoPath)).error);
    const bravo = projectClient(state.bravoContext);
    assert.ifError((await bravo.storage.from("v2-isolation-test").download(bravoPath)).error);
    assert.ok((await bravo.storage.from("v2-isolation-test").download(alphaPath)).error);
  });

  test.after(async () => {
    if (state.alpha || state.bravo) await admin.from("projects").delete().in("id", [state.alpha, state.bravo].filter(Boolean));
  });
}
