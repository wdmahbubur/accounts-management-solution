import Link from "next/link";

import { resendVerificationAction, signUpAction } from "../actions.ts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const status = first(params.status);
  const error = first(params.error);

  return (
    <main className="auth-shell">
      <p className="eyebrow">Verified account</p>
      <h1>Create account</h1>
      <section className="panel">
        {status ? (
          <p className="alert" role="status">
            If this email can receive account messages, check the inbox. Please wait before requesting another email.
          </p>
        ) : null}
        {error === "password_policy" ? (
          <p className="alert" role="alert">
            Use at least 10 characters with uppercase, lowercase and a number.
          </p>
        ) : error ? (
          <p className="alert" role="alert">Check the fields and try again.</p>
        ) : null}
        <form action={signUpAction} className="auth-form">
          <label className="field">
            <span>Display name</span>
            <input name="display_name" maxLength={120} autoComplete="name" />
          </label>
          <label className="field">
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label className="field">
            <span>Password</span>
            <input name="password" type="password" autoComplete="new-password" minLength={10} required />
          </label>
          <button type="submit">Create account</button>
        </form>
        <form action={resendVerificationAction} className="auth-form">
          <label className="field">
            <span>Resend verification</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <button type="submit" className="secondary">Request verification email</button>
        </form>
        <p className="muted">
          Verification requests use the same public response whether or not an account exists.
        </p>
        <Link href="/auth/sign-in">Back to sign in</Link>
      </section>
    </main>
  );
}
