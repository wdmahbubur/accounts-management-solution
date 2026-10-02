import Link from "next/link";

import { signInAction } from "../actions.ts";
import { safeNextPath } from "../../../server/auth/redirects.ts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next), "/companies");
  const error = first(params.error);
  const status = first(params.status);

  return (
    <main className="auth-shell">
      <p className="eyebrow">Secure access</p>
      <h1>Sign in</h1>
      <section className="panel" aria-labelledby="sign-in-title">
        <h2 id="sign-in-title">Company account</h2>
        {error ? (
          <p className="alert" role="alert">
            Email or password is incorrect, or the account is not verified.
          </p>
        ) : null}
        {status === "signed_out" ? <p className="alert">You have been signed out.</p> : null}
        {status === "verified" ? <p className="alert" role="status">Email verified. Sign in to open your company workspace.</p> : null}
        {status === "password_changed" ? <p className="alert" role="status">Password changed. Sign in with your new password.</p> : null}
        <form action={signInAction} className="auth-form">
          <input type="hidden" name="next" value={next} />
          <label className="field">
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label className="field">
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">Sign in</button>
        </form>
        <div className="link-row">
          <Link href="/auth/sign-up">Create account</Link>
          <Link href="/auth/recover">Forgot password?</Link>
        </div>
      </section>
    </main>
  );
}
