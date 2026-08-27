const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SESSION_COOKIE = "speccom_project_session";

function readCookie(header, name) {
  const match = String(header || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: { allow: "POST" }, body: "" };
  const rawToken = readCookie(event.headers.cookie, SESSION_COOKIE);
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (rawToken && serviceRoleKey && supabaseUrl) {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
    await admin.from("project_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", tokenHash).is("revoked_at", null);
  }
  return {
    statusCode: 204,
    headers: {
      "set-cookie": `${SESSION_COOKIE}=; Path=/api/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
      "cache-control": "no-store",
    },
    body: "",
  };
};
