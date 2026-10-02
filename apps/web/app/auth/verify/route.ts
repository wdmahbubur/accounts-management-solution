import { NextResponse, type NextRequest } from "next/server";

import { consumeVerificationToken, type IdentityTokenPurpose } from "../../../server/auth/identity.ts";

const tokenPurposes = new Set<IdentityTokenPurpose>(["verify_email"]);

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const rawPurpose = request.nextUrl.searchParams.get("type") ?? "verify_email";
  const target = request.nextUrl.clone();
  target.search = "";

  let ok = false;

  if (tokenPurposes.has(rawPurpose as IdentityTokenPurpose)) {
    const purpose = rawPurpose as IdentityTokenPurpose;
    ok = (await consumeVerificationToken(token, purpose)) !== null;
  }

  target.pathname = "/auth/sign-in";
  if (ok) target.searchParams.set("status", "verified");
  if (!ok) target.searchParams.set("error", "verification_failed");

  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
