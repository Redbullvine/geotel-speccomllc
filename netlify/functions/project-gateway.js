const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SESSION_COOKIE = "speccom_project_session";
const SESSION_TTL_SECONDS = 20 * 60;
const CODE_PATTERN = /^SC-[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

function json(statusCode, body, headers = {}) {
  return { statusCode, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeProjectCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function cookie(value) {
  return `${SESSION_COOKIE}=${value}; Path=/api/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function trustedClientFingerprint(event) {
  // Netlify supplies this edge-populated address. Do not use a client supplied
  // JSON field, and store only its server-side hash.
  const address = String(event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "")
    .split(",")[0].trim();
  return address ? sha256(address) : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { allow: "POST" });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    console.error("V2 gateway is missing server-only Supabase configuration.");
    return json(503, { error: "Project Gateway is unavailable." });
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Project ID not found." }); }
  const projectCode = normalizeProjectCode(payload.projectCode);
  if (!CODE_PATTERN.test(projectCode)) return json(404, { error: "Project ID not found." });

  // This client is server-only. Do not import this function or its environment
  // variables into browser code.
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const fingerprint = trustedClientFingerprint(event);
  if (!fingerprint) return json(429, { error: "Project Gateway is temporarily unavailable." });
  const { data: allowed, error: rateError } = await admin.rpc("v2_consume_gateway_attempt", { p_fingerprint_hash: fingerprint });
  if (rateError || !allowed) return json(429, { error: "Project Gateway is temporarily unavailable." }, { "retry-after": "300" });

  const now = new Date().toISOString();
  const { data: code, error: codeError } = await admin
    .from("project_access_codes")
    .select("id, project_id")
    .eq("code_hash", sha256(projectCode))
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();

  // The same generic response prevents code/project enumeration.
  if (codeError || !code) return json(404, { error: "Project ID not found." });

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, v2_status, v2_configuration")
    .eq("id", code.project_id)
    .eq("v2_status", "active")
    .maybeSingle();
  if (projectError || !project) return json(404, { error: "Project ID not found." });

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const { error: sessionError } = await admin.from("project_sessions").insert({
    project_id: project.id,
    access_code_id: code.id,
    token_hash: sha256(rawToken),
    mode: "worker",
    expires_at: expiresAt,
  });
  if (sessionError) {
    console.error("Unable to create V2 project session", sessionError.code);
    return json(503, { error: "Project Gateway is unavailable." });
  }

  const { data: modules, error: modulesError } = await admin
    .from("project_modules")
    .select("module_key, configuration, module_registry!inner(key, display_name, route, icon_key)")
    .eq("project_id", project.id)
    .eq("enabled", true)
    .eq("module_registry.active", true);
  if (modulesError) {
    console.error("Unable to load V2 project modules", modulesError.code);
    return json(503, { error: "Project Gateway is unavailable." });
  }

  // No project name, customer, access code, or cross-project metadata is returned.
  return json(200, {
    project: { id: project.id, configuration: project.v2_configuration || {} },
    modules: modules || [],
    expiresAt,
  }, { "set-cookie": cookie(rawToken), "cache-control": "no-store" });
};
