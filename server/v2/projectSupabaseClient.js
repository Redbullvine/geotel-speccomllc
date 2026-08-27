const { createClient } = require("@supabase/supabase-js");
const { mintProjectJwt } = require("./projectJwt");

function projectSupabaseClient(context) {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !publishableKey) throw new Error("V2 project data client is not configured.");
  const accessToken = mintProjectJwt(context);
  // This client uses the scoped JWT, never the service-role key. PostgreSQL RLS
  // remains the independent authority for every worker data operation.
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    accessToken: async () => accessToken,
  });
}

module.exports = { projectSupabaseClient };

