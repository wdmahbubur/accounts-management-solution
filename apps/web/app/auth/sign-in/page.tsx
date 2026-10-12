import Link from "next/link";
import { AccountShell } from "../../../components/shell/account-shell.tsx";
import styles from "../account-pages.module.css";

import { demoSignInAction, signInAction } from "../actions.ts";
import { getDemoAccountCredentials } from "../../../server/auth/demo-login.ts";
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
  const demoCredentials = getDemoAccountCredentials();

  return (
    <AccountShell title="Sign in" eyebrow="Your account" description="Use your verified email to open your workspace.">
      <section className="panel" aria-label="Account sign in">
        {error === "demo_failed" ? (
          <p className="alert" role="alert">Demo sign-in failed. Please try again.</p>
        ) : error ? (
          <p className="alert" role="alert">
            Email or password is incorrect, or the account is not verified.
          </p>
        ) : null}
        {status === "signed_out" ? <p className="alert" role="status">You have been signed out.</p> : null}
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
        <div className={styles.secondarySection}><form action={demoSignInAction} className="auth-form">
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="secondary">Sign in with demo account</button>
        </form><details className={styles.details}><summary>Demo sign-in details</summary><dl className={styles.facts}><div><dt>Email</dt><dd>{demoCredentials.email}</dd></div><div><dt>Password</dt><dd>{demoCredentials.password}</dd></div></dl></details></div>
        <div className="link-row">
          <Link href="/auth/sign-up">Create account</Link>
          <Link href="/auth/recover">Forgot password?</Link>
        </div>
      </section>
    </AccountShell>
  );
}
