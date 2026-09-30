"use server";

import type { SignOut } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { createClient } from "../../lib/supabase/server.ts";
import { authCallbackUrl, safeNextPath } from "../../server/auth/redirects.ts";

type SignOutScope = "global" | "local" | "others";

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function route(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function strongPassword(password: string): boolean {
  return (
    password.length >= 10 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  );
}

export async function signInAction(formData: FormData) {
  const email = textField(formData, "email");
  const password = textField(formData, "password");
  const next = safeNextPath(textField(formData, "next"));

  if (!validEmail(email) || password.length === 0) {
    redirect(route("/auth/sign-in", { error: "invalid_credentials", next }));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user || !data.user.email_confirmed_at) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    redirect(route("/auth/sign-in", { error: "invalid_credentials", next }));
  }

  redirect(next);
}

export async function signUpAction(formData: FormData) {
  const email = textField(formData, "email");
  const password = textField(formData, "password");
  const displayName = textField(formData, "display_name");

  if (!validEmail(email)) {
    redirect(route("/auth/sign-up", { error: "invalid_input" }));
  }
  if (!strongPassword(password)) {
    redirect(route("/auth/sign-up", { error: "password_policy" }));
  }

  const supabase = await createClient();
  await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: authCallbackUrl("/"),
      data: {
        // Presentation metadata only. Authorization never reads this object.
        display_name: displayName.slice(0, 120)
      }
    }
  });

  // Always use the same result text so existing-account state is not disclosed.
  redirect(route("/auth/sign-up", { status: "check_email" }));
}

export async function resendVerificationAction(formData: FormData) {
  const email = textField(formData, "email");

  if (validEmail(email)) {
    const supabase = await createClient();
    await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: authCallbackUrl("/") }
    });
  }

  // Provider rate-limit and account-existence outcomes intentionally collapse.
  redirect(route("/auth/sign-up", { status: "verification_requested" }));
}

export async function recoverAction(formData: FormData) {
  const email = textField(formData, "email");

  if (validEmail(email)) {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authCallbackUrl("/settings/security")
    });
  }

  // Supabase reset is enumeration-safe; keep our UI response enumeration-safe too.
  redirect(route("/auth/recover", { status: "recovery_requested" }));
}

export async function reauthenticateAction() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(route("/auth/sign-in", { next: "/settings/security" }));
  }

  await supabase.auth.reauthenticate();
  redirect(route("/settings/security", { status: "reauth_requested" }));
}

export async function updatePasswordAction(formData: FormData) {
  const password = textField(formData, "password");
  const nonce = textField(formData, "nonce");

  if (!strongPassword(password)) {
    redirect(route("/settings/security", { error: "password_policy" }));
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(route("/auth/sign-in", { next: "/settings/security" }));
  }

  const { error } = await supabase.auth.updateUser({
    password,
    ...(nonce ? { nonce } : {})
  });

  if (error) {
    redirect(route("/settings/security", { error: "password_change_failed" }));
  }

  redirect(route("/settings/security", { status: "password_changed" }));
}

export async function updateProfileAction(formData: FormData) {
  const displayName = textField(formData, "display_name").slice(0, 120);
  const locale = textField(formData, "locale");
  const timezone = textField(formData, "timezone");

  if (!displayName || !["en-BD", "bn-BD"].includes(locale) || !["Asia/Dhaka", "UTC"].includes(timezone)) {
    redirect(route("/settings/profile", { error: "invalid_profile" }));
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(route("/auth/sign-in", { next: "/settings/profile" }));
  }

  const { error } = await supabase.auth.updateUser({
    data: {
      // Presentation preferences only. These values are never role/capability authority.
      display_name: displayName,
      locale,
      timezone
    }
  });

  if (error) {
    redirect(route("/settings/profile", { error: "profile_update_failed" }));
  }

  redirect(route("/settings/profile", { status: "profile_updated" }));
}

export async function signOutAction(formData: FormData) {
  const requested = textField(formData, "scope");
  const scope: SignOutScope =
    requested === "global" || requested === "others" ? requested : "local";

  const supabase = await createClient();
  await supabase.auth.signOut({ scope } as SignOut);

  if (scope === "others") {
    redirect(route("/settings/security", { status: "other_sessions_revoked" }));
  }

  redirect(route("/auth/sign-in", { status: "signed_out" }));
}
