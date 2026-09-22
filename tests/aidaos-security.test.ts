import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { pilotRoute } from "../lib/aidaos/pilot-route";
import {
  pilotContext,
  encodeSession,
  decodeSession,
  SESSION_COOKIE,
} from "../lib/aidaos/pilot-context";
import { SandboxManager } from "../lib/sandbox/sandbox-manager";
import { VercelProvider } from "../lib/sandbox/providers/vercel-provider";

process.env.AIDAOS_OPERATOR_USERNAME = "operator";
process.env.AIDAOS_OPERATOR_PASSWORD =
  "synthetic-operator-secret-at-least-32-characters";
process.env.AIDAOS_SESSION_SECRET =
  "synthetic-session-secret-at-least-32-characters";
process.env.AIDAOS_BUILDER_ORIGIN = "https://builder.invalid";
const authorization =
  "Basic " +
  Buffer.from(
    `${process.env.AIDAOS_OPERATOR_USERNAME}:${process.env.AIDAOS_OPERATOR_PASSWORD}`,
  ).toString("base64");
const request = (headers: Record<string, string> = {}) =>
  new NextRequest("https://builder.invalid/api/publish-aidaos", {
    method: "POST",
    headers,
    body: "{}",
  });

test("route-level guard blocks unauthenticated, forged middleware, and cross-origin requests before side effects", async () => {
  let calls = 0;
  const guarded = pilotRoute(async () => {
    calls++;
    return NextResponse.json({ ok: true });
  });
  for (const headers of [
    {},
    {
      "x-middleware-subrequest":
        "middleware:middleware:middleware:middleware:middleware",
    },
    { authorization: "Basic wrong" },
  ])
    assert.equal((await guarded(request(headers))).status, 401);
  for (const headers of [
    { authorization },
    { authorization, origin: "https://evil.invalid" },
    {
      authorization,
      origin: "https://builder.invalid",
      "sec-fetch-site": "cross-site",
    },
  ])
    assert.equal((await guarded(request(headers))).status, 403);
  assert.equal(calls, 0);
  assert.equal(
    (
      await guarded(
        request({ authorization, origin: "https://builder.invalid" }),
      )
    ).status,
    200,
  );
  assert.equal(calls, 1);
});

test("missing credentials fail closed and every API method is guarded inside its route", async () => {
  const saved = process.env.AIDAOS_OPERATOR_PASSWORD;
  delete process.env.AIDAOS_OPERATOR_PASSWORD;
  assert.equal(
    (
      await pilotRoute(async () => {
        throw Error("must not run");
      })(request({ authorization, origin: "https://builder.invalid" }))
    ).status,
    401,
  );
  process.env.AIDAOS_OPERATOR_PASSWORD = saved;
  for (const entry of readdirSync("app/api")) {
    const source = readFileSync(`app/api/${entry}/route.ts`, "utf8");
    assert.doesNotMatch(
      source,
      /export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/,
      entry,
    );
    for (const m of source.matchAll(
      /export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*([^;]+)/g,
    ))
      assert.match(m[2], /^pilotRoute\(/, entry);
  }
});

test("durable signed session rejects forgery, wrong owner and expiry without a process map", () => {
  const session = {
    owner: "operator",
    sandboxId: "sbx_owned",
    expiresAt: Date.now() + 60_000,
  };
  const cookie = encodeSession(session);
  assert.deepEqual(decodeSession(cookie, "operator"), session);
  assert.equal(decodeSession(cookie, "someone-else"), null);
  assert.equal(decodeSession(cookie, "operator", session.expiresAt), null);
  assert.equal(decodeSession(cookie + "x", "operator"), null);
  assert.equal(
    decodeSession(
      encodeSession({ ...session, sandboxId: "../../secret" }),
      "operator",
    ),
    null,
  );
});

test("fresh request and manager reconnect the owned sandbox; foreign IDs never reach SDK", async () => {
  let calls = 0;
  const original = VercelProvider.prototype.reconnect;
  VercelProvider.prototype.reconnect = async function (id: string) {
    calls++;
    assert.equal(id, "sbx_owned");
  };
  try {
    const session = {
      owner: "operator",
      sandboxId: "sbx_owned",
      expiresAt: Date.now() + 60_000,
    };
    for (let instance = 0; instance < 2; instance++)
      await pilotContext.run(
        {
          owner: "operator",
          session: decodeSession(encodeSession(session), "operator"),
          activeSandboxProvider: null,
        },
        async () => {
          const manager = new SandboxManager();
          await assert.rejects(manager.getOrCreateProvider("sbx_foreign"));
          assert.ok(await manager.getOrCreateProvider("sbx_owned"));
        },
      );
    assert.equal(calls, 2);
  } finally {
    VercelProvider.prototype.reconnect = original;
  }
});

test("malicious cookie cannot grant a sandbox session through the route", async () => {
  const guarded = pilotRoute(async () => {
    await new SandboxManager().getOrCreateProvider("sbx_foreign");
    return NextResponse.json({ ok: true });
  });
  const response = await guarded(
    request({
      authorization,
      origin: "https://builder.invalid",
      cookie: `${SESSION_COOKIE}=forged.signature`,
    }),
  );
  assert.equal(response.status, 410);
});
