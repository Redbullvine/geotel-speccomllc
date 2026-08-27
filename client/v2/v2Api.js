// V2 worker client: no Supabase import, no credentials, and no project_id
// authority. The Secure HttpOnly cookie is sent automatically to /api/.
async function request(path, options = {}) {
  const response = await fetch(`/api/${String(path).replace(/^\/+/, "")}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(body?.error || "Project request failed."), { statusCode: response.status });
  return body;
}

export const v2Api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body: JSON.stringify(body || {}) }),
  patch: (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body || {}) }),
  delete: (path) => request(path, { method: "DELETE" }),
};
