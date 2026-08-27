const PROJECT_CODE_PATTERN = /^SC-[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function normalizeProjectCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidProjectCodeFormat(value) {
  return PROJECT_CODE_PATTERN.test(normalizeProjectCode(value));
}

export function sessionIsUsable(session, project) {
  if (!session || !project) return false;
  return !session.revoked_at
    && Date.parse(session.expires_at) > Date.now()
    && project.v2_status === "active";
}

// The supplied project ID is intentionally ignored. The server-derived session
// project is the only scope an operation may use.
export function projectScopeForRequest(session, suppliedProjectId = null) {
  if (!sessionIsUsable(session, { v2_status: "active" })) return null;
  return session.project_id || null;
}

export function moduleIsEnabled(enabledModuleKeys, moduleKey) {
  return new Set(enabledModuleKeys || []).has(String(moduleKey || ""));
}

export function secureSessionCookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; Path=/api/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

