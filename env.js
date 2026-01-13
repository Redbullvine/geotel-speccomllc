// Netlify can inject environment variables at build time.
// For a plain static site, easiest is to create a tiny env.js during deploy.
// In demo mode, this file is unused.
//
// If you want to hardcode for quick testing (NOT recommended for production):
// window.__ENV = { SUPABASE_URL: "https://xyz.supabase.co", SUPABASE_ANON_KEY: "..." };
