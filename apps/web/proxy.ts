import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/internal/ui-fixtures" &&
    process.env.AMS_UI_TEST_HARNESS !== "1"
  ) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/internal/ui-fixtures"
};
