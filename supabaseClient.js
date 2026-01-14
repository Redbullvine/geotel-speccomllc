// Supabase client loader.
// APP_MODE controls demo vs real; missing keys show a warning in the UI.

const env = window.ENV || {};
const { SUPABASE_URL, SUPABASE_ANON_KEY, APP_MODE } = env;

export const config = {
  url: SUPABASE_URL || "",
  anonKey: SUPABASE_ANON_KEY || "",
  appMode: String(APP_MODE || "real").toLowerCase(),
};

export const appMode = "real";
export const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const isDemo = false;

export function getSupabase(){
  if (!hasSupabaseConfig) return null;

  // Load supabase-js from CDN (keeps the starter zip simple).
  // Note: You can switch to bundling later.
  return window.supabase;
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
  await ensureSupabaseLoaded();
  return window.supabase.createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
    },
  });
}
