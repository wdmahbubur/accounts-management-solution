import Link from "next/link";

import { recoverAction } from "../actions.ts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RecoverPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const status = first(params.status);

  return (
    <main className="auth-shell">
      <p className="eyebrow">Account recovery</p>
      <h1>Reset password</h1>
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
        <Link href="/auth/sign-in">Back to sign in</Link>
      </section>
    </main>
  );
}
