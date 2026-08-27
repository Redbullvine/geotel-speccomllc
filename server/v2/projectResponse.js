function projectResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

function projectError(error) {
  const statusCode = error?.statusCode || 500;
  const message = statusCode >= 500 ? "Project service unavailable." : error.message;
  return projectResponse(statusCode, { error: message });
}

module.exports = { projectError, projectResponse };

