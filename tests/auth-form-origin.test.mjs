import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";

test("auth HTTP pages preserve form Origin without leaking token URLs; foreign/null origins remain blocked", async () => {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server/railway/server.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, PORT: String(port), APP_ENV: "homologation", DATABASE_URL: "",
      STORAGE_SELF_TEST: "0", RUN_MIGRATIONS: "0", GOOGLE_LOGIN_CLIENT_ID: "", GOOGLE_LOGIN_CLIENT_SECRET: "",
      EXPORTATRUST_ALLOWED_EMAILS: "test@example.invalid", EXPORTATRUST_ACCESS_PASSWORD: "isolated-test-bootstrap-password",
      EXPORTATRUST_SESSION_SECRET: "isolated-test-session-secret-with-32-characters" },
    stdio: "ignore",
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { const response = await fetch(`${origin}/__auth/login`); ready = response.status === 200; await response.text(); } catch { /* startup */ }
      if (ready) break;
      if (child.exitCode !== null) throw new Error("Isolated auth server exited before ready");
      await setTimeout(100);
    }
    assert.ok(ready, "isolated auth server must start");
    for (const path of ["/__auth/login", "/__auth/cadastrar", "/__auth/definir-senha?token=non-secret-test-marker"]) {
      const response = await fetch(origin + path);
      assert.equal(response.headers.get("referrer-policy"), "strict-origin", path);
      assert.equal(response.headers.get("cache-control"), "no-store");
      await response.text();
    }
    // No DB or real account: local fake credentials only. Correct-origin reaches
    // credential validation (401), not the CSRF rejection (403).
    const body = new URLSearchParams({ email: "test@example.invalid", password: "wrong-test-password" });
    const good = await fetch(`${origin}/__auth/login`, { method: "POST", headers: { origin }, body });
    assert.equal(good.status, 401);
    assert.match(await good.text(), /E-mail ou senha inválidos/);
    for (const bad of ["null", "https://attacker.invalid", undefined]) {
      const response = await fetch(`${origin}/__auth/login`, { method: "POST", headers: bad ? { origin: bad } : {}, body });
      assert.equal(response.status, 403);
      assert.match(await response.text(), /Origem da requisição não autorizada/);
    }
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once("exit", resolve));
  }
});
