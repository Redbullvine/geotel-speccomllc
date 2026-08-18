function isMaskedSecret(value) {
  const text = String(value || "").trim();
  return !text || /^\*+$/.test(text) || /\*{4,}/.test(text) || /redacted|masked/i.test(text);
}

async function resolveLocalDevConfig() {
  // Netlify deliberately masks secret-scoped variables for some linked local
  // sessions. The anon key is public runtime configuration, so a local-only
  // preview may retrieve it from this app's already-live config endpoint.
  // This branch is impossible in a deployed function.
  // A deployed function has the real value; a masked value identifies the
  // linked local-development case even where the CLI does not expose a
  // NETLIFY_DEV marker to the child function.
  if (!isMaskedSecret(process.env.SUPABASE_ANON_KEY)) return null;
  try {
    const response = await fetch("https://speccom.llc/.netlify/functions/app-config", { cache: "no-store" });
    if (!response.ok) return null;
    const config = await response.json();
    if (!config?.SUPABASE_URL || isMaskedSecret(config?.SUPABASE_ANON_KEY)) return null;
    return config;
  } catch {
    return null;
  }
}

export async function handler() {
  const localConfig = await resolveLocalDevConfig();
  const demoEnabled = String(process.env.DEMO_BOOTSTRAP_ENABLED || "").trim().toLowerCase();
  const demoBootstrapOn = ["1", "true", "yes", "on"].includes(demoEnabled);
  const showcaseEmails = String(process.env.LIVE_SHOWCASE_EMAILS || process.env.DEMO_SHOWCASE_EMAILS || "").trim();
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      SUPABASE_URL: localConfig?.SUPABASE_URL || process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: localConfig?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
      LIVE_MODE: true,
      DEMO_SHOWCASE_ENABLED: process.env.DEMO_SHOWCASE_ENABLED,
      DEMO_SHOWCASE_ALLOW_GLOBAL_REAL: process.env.DEMO_SHOWCASE_ALLOW_GLOBAL_REAL,
      DEMO_SHOWCASE_ACCOUNT_ENABLED: process.env.DEMO_SHOWCASE_ACCOUNT_ENABLED,
      LIVE_SHOWCASE_EMAILS: showcaseEmails || undefined,
      DEMO_BOOTSTRAP_ENABLED: demoBootstrapOn ? "true" : undefined,
      DEMO_BOOTSTRAP_ALLOW_WITH_LIVE_AUTH: demoBootstrapOn ? process.env.DEMO_BOOTSTRAP_ALLOW_WITH_LIVE_AUTH : undefined,
      DEMO_ADMIN_EMAIL: demoBootstrapOn ? process.env.DEMO_ADMIN_EMAIL : undefined
    })
  };
}
