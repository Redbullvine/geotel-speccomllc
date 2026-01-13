// Supabase client loader.
// If SUPABASE_URL / SUPABASE_ANON_KEY aren't present, the app runs in DEMO mode.

export const config = {
  url: (window.__ENV && window.__ENV.SUPABASE_URL) || "",
  anonKey: (window.__ENV && window.__ENV.SUPABASE_ANON_KEY) || "",
};

export const isDemo = !config.url || !config.anonKey;

export function getSupabase(){
  if (isDemo) return null;

  // Load supabase-js from CDN (keeps the starter zip simple).
  // Note: You can switch to bundling later.
  return window.supabase;
}

export async function ensureSupabaseLoaded(){
  if (isDemo) return;

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
  if (isDemo) return null;
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
