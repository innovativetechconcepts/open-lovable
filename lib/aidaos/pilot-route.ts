import { NextRequest, NextResponse } from "next/server";
import { operatorAuthorized, sameOriginRequest } from "./pilot-auth";
import {
  pilotContext,
  SESSION_COOKIE,
  decodeSession,
  encodeSession,
} from "./pilot-context";
import { VercelProvider } from "@/lib/sandbox/providers/vercel-provider";

/** This guard runs inside every handler; middleware is only an extra UI gate. */
export function pilotRoute(
  handler: (request: NextRequest) => Promise<Response>,
) {
  return async (request: NextRequest): Promise<Response> => {
    if (!(await operatorAuthorized(request.headers)))
      return new NextResponse("Operator authentication required", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="aidaOS builder", charset="UTF-8"',
          "Cache-Control": "no-store",
        },
      });
    if (!sameOriginRequest(request))
      return NextResponse.json(
        { error: "Same-origin operator request required" },
        { status: 403 },
      );
    const owner = process.env.AIDAOS_OPERATOR_USERNAME!;
    const session = decodeSession(
      request.cookies.get(SESSION_COOKIE)?.value,
      owner,
    );
    const path = new URL(request.url).pathname;
    // The legacy E2B creation endpoint cannot establish an owned pilot session.
    if (path === "/api/create-ai-sandbox")
      return NextResponse.json(
        { error: "Use the authenticated Vercel builder" },
        { status: 410 },
      );
    return pilotContext.run(
      {
        owner,
        session,
        activeSandboxProvider: null,
        existingFiles: new Set<string>(),
        viteErrors: [],
        requestHeaders: request.headers,
      },
      async () => {
        const { pilotState } = await import("./pilot-context");
        const state = pilotState();
        try {
          if (
            session &&
            !["/api/create-ai-sandbox-v2", "/api/publish-aidaos"].includes(path)
          ) {
            const provider = new VercelProvider({});
            await provider.reconnect(session.sandboxId);
            state.activeSandboxProvider = provider;
            state.activeSandbox = provider.getSdkSandbox();
            state.sandboxData = provider.getSandboxInfo();
            state.sandboxState = {
              fileCache: {
                files: {},
                lastSync: Date.now(),
                sandboxId: session.sandboxId,
              },
              sandbox: provider,
              sandboxData: state.sandboxData,
            };
          }
          const response = await handler(request);
          response.headers.set("Cache-Control", "private, no-store");
          if (state.session && state.session !== session) {
            response.headers.append(
              "Set-Cookie",
              `${SESSION_COOKIE}=${encodeSession(state.session)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800`,
            );
          } else if (!state.session && session) {
            response.headers.append(
              "Set-Cookie",
              `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`,
            );
          }
          return response;
        } catch {
          return NextResponse.json(
            {
              error:
                "The builder session is unavailable. Create a new session.",
              code: "builder_session_unavailable",
            },
            { status: 410, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    );
  };
}
