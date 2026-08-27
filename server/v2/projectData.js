const { requireProjectSession } = require("./projectSession");
const { projectSupabaseClient } = require("./projectSupabaseClient");

async function withProjectData(request, handler) {
  const context = await requireProjectSession(request);
  const client = projectSupabaseClient(context);
  return handler({ context, client });
}

module.exports = { withProjectData };

