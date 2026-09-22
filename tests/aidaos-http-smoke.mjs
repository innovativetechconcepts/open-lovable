import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import assert from "node:assert/strict";
const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise((r) => server.close(r));
const origin = `http://127.0.0.1:${port}`;
const password = "synthetic-http-test-password-at-least-32-characters";
const authorization =
  "Basic " + Buffer.from(`operator:${password}`).toString("base64");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ],
  {
    env: {
      ...process.env,
      AIDAOS_OPERATOR_USERNAME: "operator",
      AIDAOS_OPERATOR_PASSWORD: password,
      AIDAOS_SESSION_SECRET:
        "synthetic-cookie-signing-key-at-least-32-characters",
      AIDAOS_BUILDER_ORIGIN: origin,
      AIDAOS_PUBLISHING_ENABLED: "false",
    },
    stdio: "ignore",
  },
);
const cases = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(origin);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(ready);
  for (const path of [
    "/",
    "/generation",
    "/api/sandbox-status",
    "/api/run-command-v2",
    "/api/publish-aidaos",
  ]) {
    const apiPost =
      path.includes("run-command") || path.includes("publish-aidaos");
    const result = await fetch(origin + path, {
      method: apiPost ? "POST" : "GET",
      headers: {
        "x-middleware-subrequest":
          "middleware:middleware:middleware:middleware:middleware",
      },
      ...(apiPost ? { body: "{}" } : {}),
    });
    assert.equal(result.status, 401, path);
    cases.push({ path, anonymousStatus: result.status });
  }
  const authorized = await fetch(origin + "/api/sandbox-status", {
    headers: { authorization },
  });
  assert.equal(authorized.status, 200, await authorized.clone().text());
  assert.equal((await authorized.json()).active, false);
  const foreign = await fetch(origin + "/api/publish-aidaos", {
    method: "POST",
    headers: { authorization, origin: "https://attacker.invalid" },
    body: "{}",
  });
  assert.equal(foreign.status, 403);
  const disabled = await fetch(origin + "/api/publish-aidaos", {
    method: "POST",
    headers: { authorization, origin },
    body: "{}",
  });
  assert.equal(disabled.status, 404);
  console.log(
    JSON.stringify(
      {
        cases,
        authorizedStatus: 200,
        foreignOriginStatus: 403,
        disabledPublisherStatus: 404,
      },
      null,
      2,
    ),
  );
} finally {
  child.kill("SIGTERM");
  await once(child, "exit");
}
