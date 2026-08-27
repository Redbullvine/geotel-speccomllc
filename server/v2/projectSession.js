const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SESSION_COOKIE = "speccom_project_session";

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function readCookie(header, name = SESSION_COOKIE) {
  const match = String(header || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function sessionAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("V2 session authority is not configured.");
  // This is deliberately limited to session/control-plane verification. It must
  // never be used by worker project-data handlers.
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireProjectSession(request) {
  const rawToken = readCookie(request?.headers?.cookie);
  if (!rawToken || rawToken.length < 40) {
    const error = new Error("Project session required.");
    error.statusCode = 401;
    throw error;
  }
  const admin = sessionAdminClient();
  const { data, error } = await admin
    .from("project_sessions")
    .select("id, project_id, mode, expires_at, revoked_at, projects!inner(id, v2_status)")
    .eq("token_hash", sha256(rawToken))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .eq("projects.v2_status", "active")
    .maybeSingle();
  if (error || !data || data.mode !== "worker") {
    const failure = new Error("Project session is not active.");
    failure.statusCode = 401;
    throw failure;
  }
  return { sessionId: data.id, projectId: data.project_id, mode: data.mode, expiresAt: data.expires_at };
}

module.exports = { SESSION_COOKIE, readCookie, requireProjectSession, sha256 };

