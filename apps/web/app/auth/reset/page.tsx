import Link from "next/link";

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
    <main className="auth-shell">
      <meta name="referrer" content="no-referrer" />
      <p className="eyebrow">Account recovery</p>
      <h1>Choose a new password</h1>
      <section className="panel">
        {error ? <p className="alert" role="alert">The reset link is invalid or expired. Request another one.</p> : null}
        {token ? <form action={resetPasswordAction} className="auth-form">
          <input type="hidden" name="token" value={token} />
          <label className="field"><span>New password</span>
            <input name="password" type="password" autoComplete="new-password" minLength={10} required />
          </label>
          <button type="submit">Set new password</button>
        </form> : <p className="alert" role="alert">A reset token is required.</p>}
        <Link href="/auth/sign-in">Back to sign in</Link>
      </section>
    </main>
  );
}
