const { withProjectData } = require("../../server/v2/projectData");
const { requireProjectModule } = require("../../server/v2/requireProjectModule");
const { projectError, projectResponse } = require("../../server/v2/projectResponse");

function parseBody(event) {
  try { return JSON.parse(event.body || "{}"); } catch { throw Object.assign(new Error("Invalid request."), { statusCode: 400 }); }
}

exports.handler = async (event) => {
  try {
    return await withProjectData(event, async ({ context, client }) => {
      await requireProjectModule(context, "tasks");
      if (event.httpMethod === "GET") {
        const { data, error } = await client.from("v2_test_records").select("id, name, kind").order("created_at");
        if (error) throw error;
        return projectResponse(200, { records: data || [] });
      }
      if (event.httpMethod === "POST") {
        const body = parseBody(event);
        if (body.project_id && body.project_id !== context.projectId) throw Object.assign(new Error("Project mismatch."), { statusCode: 403 });
        const { data, error } = await client.from("v2_test_records")
          .insert({ project_id: context.projectId, name: String(body.name || "").trim(), kind: "task" })
          .select("id, name, kind").single();
        if (error) throw error;
        return projectResponse(201, { record: data });
      }
      if (event.httpMethod === "PATCH") {
        const body = parseBody(event);
        if (!body.id || body.project_id && body.project_id !== context.projectId) throw Object.assign(new Error("Project mismatch."), { statusCode: 403 });
        const { data, error } = await client.from("v2_test_records").update({ name: String(body.name || "").trim() })
          .eq("id", body.id).select("id, name, kind").maybeSingle();
        if (error) throw error;
        return data ? projectResponse(200, { record: data }) : projectResponse(404, { error: "Record not found." });
      }
      if (event.httpMethod === "DELETE") {
        const id = String(event.queryStringParameters?.id || "");
        const { data, error } = await client.from("v2_test_records").delete().eq("id", id).select("id").maybeSingle();
        if (error) throw error;
        return data ? projectResponse(200, { deleted: true }) : projectResponse(404, { error: "Record not found." });
      }
      return projectResponse(405, { error: "Method not allowed." }, { allow: "GET, POST, PATCH, DELETE" });
    });
  } catch (error) {
    return projectError(error);
  }
};
