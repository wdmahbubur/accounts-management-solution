"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { auth, signIn, signOut } from "../../../../auth.ts";
import { createRequestClient } from "../../server/request-client.ts";
import { sendIdentityLink } from "../../server/auth/mailer.ts";
import {
  changeIdentityPassword,
  createIdentityUser,
  findUnverifiedIdentityId,
  findVerifiedIdentityId,
  issueIdentityToken,
  normalizeEmail,
  resetIdentityPassword
} from "../../server/auth/identity.ts";
import { safeNextPath } from "../../server/auth/redirects.ts";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function route(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function strongPassword(password: string): boolean {
  return password.length >= 10 && password.length <= 1024 && /[a-z]/.test(password) &&
    /[A-Z]/.test(password) && /\d/.test(password);
}

export async function signInAction(formData: FormData) {
  const email = field(formData, "email");
  const password = field(formData, "password");
  const next = safeNextPath(field(formData, "next"), "/companies");
  if (!validEmail(email) || !password) redirect(route("/auth/sign-in", { error: "invalid_credentials", next }));

  try {
    await signIn("credentials", { email: normalizeEmail(email), password, redirectTo: next });
  } catch (error) {
    if (error instanceof AuthError) redirect(route("/auth/sign-in", { error: "invalid_credentials", next }));
    throw error;
  }
}

export async function signUpAction(formData: FormData) {
  const email = field(formData, "email");
  const password = field(formData, "password");
  const displayName = field(formData, "display_name").slice(0, 120);
  if (!validEmail(email)) redirect(route("/auth/sign-up", { error: "invalid_input" }));
  if (!strongPassword(password)) redirect(route("/auth/sign-up", { error: "password_policy" }));

  try {
    const userId = await createIdentityUser(email, password, displayName);
    if (userId) {
      const token = await issueIdentityToken(userId, "verify_email");
      await sendIdentityLink(normalizeEmail(email), "verify_email", token);
    }
  } catch {
    // Keep the response enumeration-safe and never expose mail or database errors.
  }
  redirect(route("/auth/sign-up", { status: "check_email" }));
}

export async function resendVerificationAction(formData: FormData) {
  const email = field(formData, "email");
  if (validEmail(email)) {
    try {
      const userId = await findUnverifiedIdentityId(email);
      if (userId) await sendIdentityLink(normalizeEmail(email), "verify_email", await issueIdentityToken(userId, "verify_email"));
    } catch {
      // Enumeration-safe public response.
    }
  }
  redirect(route("/auth/sign-up", { status: "verification_requested" }));
}

export async function recoverAction(formData: FormData) {
  const email = field(formData, "email");
  if (validEmail(email)) {
    try {
      const userId = await findVerifiedIdentityId(email);
      if (userId) await sendIdentityLink(normalizeEmail(email), "reset_password", await issueIdentityToken(userId, "reset_password"));
    } catch {
      // Enumeration-safe public response.
    }
  }
  redirect(route("/auth/recover", { status: "recovery_requested" }));
}

export async function resetPasswordAction(formData: FormData) {
  const token = field(formData, "token");
  const password = field(formData, "password");
  if (!strongPassword(password)) redirect(route("/auth/reset", { token, error: "password_policy" }));
  const completed = await resetIdentityPassword(token, password).catch(() => false);
  if (!completed) redirect(route("/auth/reset", { error: "invalid_token" }));
  await signOut({ redirectTo: route("/auth/sign-in", { status: "password_changed" }) });
}

export async function reauthenticateAction() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) redirect(route("/auth/sign-in", { next: "/settings/security" }));
  try {
    const token = await issueIdentityToken(session.user.id, "reauthenticate");
    await sendIdentityLink(session.user.email, "reauthenticate", token);
  } catch {
    redirect(route("/settings/security", { error: "reauthentication_unavailable" }));
  }
  redirect(route("/settings/security", { status: "reauth_requested" }));
}

export async function updatePasswordAction(formData: FormData) {
  const password = field(formData, "password");
  if (!strongPassword(password)) redirect(route("/settings/security", { error: "password_policy" }));
  const session = await auth();
  if (!session?.user?.id) redirect(route("/auth/sign-in", { next: "/settings/security" }));
  try {
    await changeIdentityPassword(session.user.id, password);
  } catch {
    redirect(route("/settings/security", { error: "recent_auth_required" }));
  }
  await signOut({ redirectTo: route("/auth/sign-in", { status: "password_changed" }) });
}

export async function updateProfileAction(formData: FormData) {
  const displayName = field(formData, "display_name").slice(0, 120);
  const locale = field(formData, "locale");
  const timezone = field(formData, "timezone");
  if (!displayName || !["en-BD", "bn-BD"].includes(locale) || !["Asia/Dhaka", "UTC"].includes(timezone)) {
    redirect(route("/settings/profile", { error: "invalid_profile" }));
  }

  const result = await createRequestClient().rpc("update_own_profile", {
    p_display_name: displayName, p_locale: locale, p_timezone: timezone
  });
  if (result.error) redirect(route("/settings/profile", { error: "profile_update_failed" }));
  redirect(route("/settings/profile", { status: "profile_updated" }));
}

export async function signOutAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || !session.user.sessionId) {
    await signOut({ redirectTo: route("/auth/sign-in", { status: "signed_out" }) });
    return;
  }
  const scope = field(formData, "scope");
  if (scope === "others" || scope === "global") {
    const client = createRequestClient();
    await client.auth.getUser();
    const { withDatabase } = await import("../../server/database.ts");
    await withDatabase((db) => db.query(
      `UPDATE identity.auth_sessions SET revoked_at = now()
       WHERE user_id = $1::uuid AND revoked_at IS NULL
         AND ($2::boolean OR id <> $3::uuid)`,
      [session.user.id, scope === "global", session.user.sessionId]
    ));
  }
  if (scope === "others") redirect(route("/settings/security", { status: "other_sessions_revoked" }));
  await signOut({ redirectTo: route("/auth/sign-in", { status: "signed_out" }) });
}
