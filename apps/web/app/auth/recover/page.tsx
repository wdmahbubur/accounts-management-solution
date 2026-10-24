import Link from "next/link";
import { AccountShell } from "../../../components/shell/account-shell.tsx";
import styles from "../account-pages.module.css";

import { recoverAction } from "../actions.ts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RecoverPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const status = first(params.status);

  return (
    <AccountShell title="Reset password" eyebrow="Account recovery" description="Enter your email to request a password reset link.">
      <section className="panel">
        {status === "recovery_requested" ? (
          <p className="alert" role="status">
            If an account can receive recovery email at that address, a reset message will arrive. Please wait before retrying.
          </p>
        ) : null}
        <form action={recoverAction} className="auth-form">
          <label className="field">
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <button type="submit">Request reset email</button>
        </form>
        <Link className={styles.help} href="/auth/sign-in">Back to sign in</Link>
      </section>
    </AccountShell>
  );
}
