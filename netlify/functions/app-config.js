exports.handler = async function handler() {
  const payload = {
    SUPABASE_URL: process.env.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
    APP_MODE: process.env.APP_MODE || "real",
  };
  const body = `window.ENV = ${JSON.stringify(payload)};`;
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-store",
    },
    body,
  };
};
