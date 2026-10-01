export const RECENT_AUTH_WINDOW_MS = 24 * 60 * 60 * 1000;

export const sensitiveRecentAuthOperations = [
  "owner_membership_change",
  "period_close",
  "period_reopen",
  "support_access_grant"
] as const;

export type SensitiveRecentAuthOperation =
  (typeof sensitiveRecentAuthOperations)[number];

export class RecentAuthenticationRequiredError extends Error {
  constructor() {
    super("Recent authentication is required.");
    this.name = "RecentAuthenticationRequiredError";
  }
}

export interface RecentAuthUser {
  id: string;
  last_sign_in_at?: string | null;
}

export interface RecentAuthReader {
  getUser(): Promise<{
    data: { user: RecentAuthUser | null };
    error: unknown | null;
  }>;
}

export function hasRecentAuthentication(
  lastSignInAt: string | null | undefined,
  now = new Date()
): boolean {
  if (!lastSignInAt) {
    return false;
  }

  const signedInAt = Date.parse(lastSignInAt);
  if (!Number.isFinite(signedInAt)) {
    return false;
  }

  const age = now.getTime() - signedInAt;
  return age >= 0 && age <= RECENT_AUTH_WINDOW_MS;
}

export async function requireRecentAuthentication(
  auth: RecentAuthReader,
  now = new Date()
): Promise<RecentAuthUser> {
  const {
    data: { user },
    error
  } = await auth.getUser();

  if (error || !user) {
    throw new RecentAuthenticationRequiredError();
  }

  if (!hasRecentAuthentication(user.last_sign_in_at, now)) {
    throw new RecentAuthenticationRequiredError();
  }

  return user;
}

export async function requireRecentAuthenticationFor(
  operation: SensitiveRecentAuthOperation,
  auth: RecentAuthReader,
  now = new Date()
): Promise<RecentAuthUser> {
  if (!sensitiveRecentAuthOperations.includes(operation)) {
    throw new Error("Unknown sensitive operation.");
  }

  return requireRecentAuthentication(auth, now);
}
