const SAFE_ORIGIN = "https://ams.invalid";

export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("\0")
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, SAFE_ORIGIN);
    if (parsed.origin !== SAFE_ORIGIN) {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function authCallbackUrl(next = "/"): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("Missing required public environment variable: NEXT_PUBLIC_APP_URL");
  }

  const url = new URL("/auth/verify", appUrl);
  url.searchParams.set("next", safeNextPath(next));
  return url.toString();
}
