"use client";

import { useActionState, useState } from "react";

import type { RegistrationState } from "../../../server/auth/registration.ts";
import { resendVerificationAction, signUpAction } from "../actions.ts";
import styles from "../account-pages.module.css";

function Feedback({ state }: { state: RegistrationState }) {
  if (state.error) return <p className="alert" role="alert">
    {state.error === "password_policy" ? "Use at least 10 characters with uppercase, lowercase and a number."
      : state.error === "email_unavailable" ? "Account email is temporarily unavailable. Try again later."
      : "Check the fields and try again."}
  </p>;
  return state.status ? <p className="alert" role="status">
    If this email can receive account messages, check the inbox. Please wait before requesting another email.
  </p> : null;
}

export function SignupForms({ initialState = {} }: { initialState?: RegistrationState }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [resendEmail, setResendEmail] = useState<string | null>(null);
  const [signup, signupAction, signingUp] = useActionState(signUpAction, initialState);
  const [resend, resendAction, resending] = useActionState(resendVerificationAction, {});

  return <>
    <Feedback state={signup} />
    <form action={signupAction} className="auth-form" aria-label="Create personal account">
      <div className="field">
        <label htmlFor="signup-name"><span>Display name</span></label>
        <input id="signup-name" name="display_name" maxLength={120} autoComplete="name" value={name} onChange={event => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="signup-email"><span>Email</span></label>
        <input id="signup-email" name="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="signup-password"><span>Password</span></label>
        <input id="signup-password" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={1024} required aria-describedby="signup-password-help" />
        <small id="signup-password-help" className={styles.help}>At least 10 characters, including uppercase, lowercase and a number.</small>
      </div>
      <button type="submit" disabled={signingUp || resending}>{signingUp ? "Creating account…" : "Create account"}</button>
    </form>
    <details className={styles.details} open={Boolean(signup.status || resend.status || resend.error) || undefined}>
      <summary>Need another verification email?</summary>
      <Feedback state={resend} />
      <form action={resendAction} className="auth-form" aria-label="Resend email verification">
        <div className="field">
          <label htmlFor="verification-email"><span>Email</span></label>
          <input id="verification-email" name="email" type="email" autoComplete="email" required value={resendEmail ?? email} onChange={event => setResendEmail(event.target.value)} />
        </div>
        <button type="submit" className="secondary" disabled={resending || signingUp}>{resending ? "Requesting email…" : "Request verification email"}</button>
      </form>
      <p className="muted">Check your inbox and spam folder. Please wait before requesting another email.</p>
    </details>
  </>;
}
