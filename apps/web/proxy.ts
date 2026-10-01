import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "./lib/supabase/proxy.ts";

export function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/internal/ui-fixtures" &&
    process.env.AMS_UI_TEST_HARNESS !== "1"
  ) {
    return new NextResponse(null, { status: 404 });
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/auth/:path*",
    "/settings/:path*",
    "/companies/:path*",
    "/o/:path*",
    "/internal/ui-fixtures"
  ]
};
