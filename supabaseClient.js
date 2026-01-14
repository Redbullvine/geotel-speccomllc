// Supabase client loader.
// APP_MODE controls demo vs real; missing keys show a warning in the UI.

const runtimeEnv = window.__ENV__ || window.__ENV || window.ENV || {};
const { SUPABASE_URL, SUPABASE_ANON_KEY, APP_MODE } = runtimeEnv;

export const config = {
  url: SUPABASE_URL || "",
  anonKey: SUPABASE_ANON_KEY || "",
  appMode: String(APP_MODE || "real").toLowerCase(),
};

export const appMode = "real";
export const hasSupabaseConfig = Boolean(config.url && config.anonKey);
export const isDemo = false;

let _clientPromise = null;
let _client = null;

export function getSupabase(){
  return _client;
}

export async function ensureSupabaseLoaded(){
  if (!hasSupabaseConfig) return;

  if (window.supabase) return;

  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function makeClient(){
  if (!hasSupabaseConfig) return null;
  if (_client) return _client;
  if (_clientPromise) return _clientPromise;
  _clientPromise = (async () => {
    await ensureSupabaseLoaded();
    _client = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
      },
    });
    return _client;
  })();
  return _clientPromise;
}
