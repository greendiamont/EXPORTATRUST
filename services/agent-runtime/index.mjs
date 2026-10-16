import http from "node:http";

const port = Number(process.env.PORT || 3000);
const env = process.env.APP_ENV || "unknown";
const role = process.env.AGENT_ROLE || "unknown";
const targetBranch = process.env.TARGET_BRANCH || "unknown";
const requireHumanApproval = process.env.REQUIRE_HUMAN_APPROVAL === "true";
const allowDirectProductionChanges = process.env.ALLOW_DIRECT_PRODUCTION_CHANGES === "true";

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "exportatrust-agent-runtime",
      environment: env,
      role,
      targetBranch,
      ready: true,
    });
  }

  if (req.method === "GET" && url.pathname === "/status") {
    return json(res, 200, {
      ok: true,
      environment: env,
      role,
      targetBranch,
      policies: {
        requireHumanApproval,
        allowDirectProductionChanges,
      },
      changeControl: {
        changelog: process.env.CHANGELOG_PATH || "docs/change-control/CHANGELOG.md",
        currentState: process.env.CURRENT_STATE_PATH || "docs/change-control/CURRENT_STATE.md",
      },
    });
  }

  if (req.method === "POST" && url.pathname === "/execute") {
    if (env === "production") {
      return json(res, 423, {
        ok: false,
        blocked: true,
        reason: "Production execution is locked behind explicit human approval and promotion from homologation.",
      });
    }
    return json(res, 202, {
      ok: true,
      accepted: true,
      mode: "homologation",
      message: "Agent runtime is online and ready for homologation orchestration. Business actions are delegated to the ExportaTrust Agent API as it is connected.",
    });
  }

  return json(res, 200, {
    service: "exportatrust-agent-runtime",
    endpoints: ["/health", "/status", "/execute"],
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`ExportaTrust agent runtime listening on :${port} (${env}/${role})`);
});
