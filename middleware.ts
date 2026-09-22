import { NextRequest, NextResponse } from "next/server";
import { operatorAuthorized, sameOriginRequest } from "./lib/aidaos/pilot-auth";

export async function middleware(request: NextRequest) {
  if (!(await operatorAuthorized(request.headers)))
    return new NextResponse("Operator authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="aidaOS builder", charset="UTF-8"',
        "Cache-Control": "no-store",
      },
    });
  if (!sameOriginRequest(request))
    return new NextResponse("Forbidden origin", { status: 403 });
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  return response;
}
export const config = { matcher: ["/:path*"] };
