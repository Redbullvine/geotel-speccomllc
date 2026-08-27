const crypto = require("crypto");

function base64url(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
  return bytes
    .toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function requireSigningKey() {
  const raw = process.env.V2_PROJECT_JWT_PRIVATE_JWK;
  const kid = process.env.V2_PROJECT_JWT_KID;
  if (!raw || !kid) throw new Error("V2 project JWT signing is not configured.");
  return { key: crypto.createPrivateKey({ key: JSON.parse(raw), format: "jwk" }), kid };
}

function mintProjectJwt(context, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!context?.projectId || !context?.sessionId) throw new Error("Project context is required.");
  const { key, kid } = requireSigningKey();
  const header = { alg: "ES256", typ: "JWT", kid };
  const payload = {
    sub: context.sessionId,
    role: "authenticated",
    access_kind: "project_session",
    project_session_id: context.sessionId,
    project_id: context.projectId,
    iat: nowSeconds,
    exp: Math.min(nowSeconds + 120, Math.floor(new Date(context.expiresAt).getTime() / 1000)),
  };
  const unsigned = `${base64url(header)}.${base64url(payload)}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${base64url(signature)}`;
}

module.exports = { mintProjectJwt };
