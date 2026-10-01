import { CommandError } from "../commands/errors.ts";

/** Cookie-authenticated Route Handlers do not inherit Server Action CSRF checks.
 * Pin the browser origin to deployment configuration, not the internal/proxied
 * Request URL or client-controlled Host / X-Forwarded-Host headers.
 */
export function assertMutationOrigin(
  headers: Pick<Headers, "get">,
  applicationUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL
): void {
  let trusted: URL;
  try {
    if (!applicationUrl) throw new Error("Missing app URL");
    trusted = new URL(applicationUrl);
    if (!["http:", "https:"].includes(trusted.protocol) || trusted.username || trusted.password) {
      throw new Error("Invalid app URL");
    }
  } catch {
    // Configuration failure must never turn into permissive origin handling.
    throw new Error("Configure a valid NEXT_PUBLIC_APP_URL before enabling cookie-authenticated mutations.");
  }
  const origin = headers.get("origin");
  if (!origin || origin !== trusted.origin || headers.get("sec-fetch-site") === "cross-site") {
    throw CommandError.forbidden();
  }
}
