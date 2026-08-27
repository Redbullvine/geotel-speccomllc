const { projectSupabaseClient } = require("./projectSupabaseClient");

async function requireProjectModule(context, moduleKey) {
  const client = projectSupabaseClient(context);
  const { data, error } = await client
    .from("project_modules")
    .select("enabled")
    .eq("project_id", context.projectId)
    .eq("module_key", moduleKey)
    .maybeSingle();
  if (error || !data?.enabled) {
    const failure = new Error("This tool is not enabled for the project.");
    failure.statusCode = 403;
    throw failure;
  }
  return context;
}

module.exports = { requireProjectModule };

