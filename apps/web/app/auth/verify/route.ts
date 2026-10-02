import { NextResponse, type NextRequest } from "next/server";

import { auth } from "../../../../../auth.ts";
import { consumeVerificationToken, type IdentityTokenPurpose } from "../../../server/auth/identity.ts";
import { safeNextPath } from "../../../server/auth/redirects.ts";

const tokenPurposes = new Set<IdentityTokenPurpose>(["verify_email", "reauthenticate"]);

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const rawPurpose = request.nextUrl.searchParams.get("type") ?? "verify_email";
  const target = request.nextUrl.clone();
  target.search = "";

  let ok = false;
  let successPath = "/auth/sign-in?status=verified";
  if (tokenPurposes.has(rawPurpose as IdentityTokenPurpose)) {
    const purpose = rawPurpose as IdentityTokenPurpose;
    const expectedUserId = purpose === "reauthenticate" ? (await auth())?.user?.id : undefined;
    if (purpose !== "reauthenticate" || expectedUserId) {
      ok = (await consumeVerificationToken(token, purpose, expectedUserId)) !== null;
      if (purpose === "reauthenticate") successPath = "/settings/security?status=reauthenticated";
    }
  }

  target.pathname = ok ? safeNextPath(successPath, "/companies").split("?")[0] : "/auth/sign-in";
  if (ok && successPath.includes("?")) {
    const success = new URL(successPath, target.origin);
    success.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  }
  if (!ok) target.searchParams.set("error", "verification_failed");

  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
