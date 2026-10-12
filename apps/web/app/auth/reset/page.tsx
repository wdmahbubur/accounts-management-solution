import Link from "next/link";
import { AccountShell } from "../../../components/shell/account-shell.tsx";
import styles from "../account-pages.module.css";

import { resetPasswordAction } from "../actions.ts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = first(params.token) ?? "";
  const error = first(params.error);
  return (
    <AccountShell title="Choose a new password" eyebrow="Account recovery" description="Set a new password for your account.">
      <meta name="referrer" content="no-referrer" />
      <section className="panel">
        {error ? <p className="alert" role="alert">The reset link is invalid or expired. Request another one.</p> : null}
        {token ? <form action={resetPasswordAction} className="auth-form">
          <input type="hidden" name="token" value={token} />
          <label className="field"><span>New password</span>
            <input name="password" type="password" autoComplete="new-password" minLength={10} required aria-describedby="reset-password-help" />
            <small id="reset-password-help" className={styles.help}>At least 10 characters, including uppercase, lowercase and a number.</small>
          </label>
          <button type="submit">Set new password</button>
        </form> : <p className="alert" role="alert">A reset token is required.</p>}
        {(!token||error)&&<Link className="secondary" href="/auth/recover">Request a new reset link</Link>}
        <Link href="/auth/sign-in">Back to sign in</Link>
      </section>
    </AccountShell>
  );
}
