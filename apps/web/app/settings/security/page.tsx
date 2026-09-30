import { redirect } from "next/navigation";

import { createClient } from "../../lib/supabase/server.ts";
import {
  reauthenticateAction,
  signOutAction,
  updatePasswordAction
} from "../auth/actions.ts";
import { hasRecentAuthentication } from "../../server/auth/recent-auth.ts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const dynamic = "force-dynamic";

export default async function SecurityPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/settings/security");
  }

  const params = await searchParams;
  const status = first(params.status);
  const error = first(params.error);
  const recent = hasRecentAuthentication(user.last_sign_in_at);

  return (
    <main className="auth-shell">
      <p className="eyebrow">Personal settings</p>
      <h1>Security</h1>
      <div className="security-grid">
        <section className="panel">
          <h2>Account</h2>
          <p><strong>Email:</strong> {user.email ?? "Verified account"}</p>
          <p className="muted">
            Recent authentication: <strong>{recent ? "yes" : "required for sensitive changes"}</strong>
          </p>
          {status ? <p className="alert" role="status">Security action completed.</p> : null}
          {error === "password_policy" ? (
            <p className="alert" role="alert">Use at least 10 characters with uppercase, lowercase and a number.</p>
          ) : error ? (
            <p className="alert" role="alert">The security action could not be completed. Reauthenticate and try again.</p>
          ) : null}
        </section>

        <section className="panel">
          <h2>Change password</h2>
          <form action={updatePasswordAction} className="settings-form">
            <label className="field">
              <span>New password</span>
              <input name="password" type="password" autoComplete="new-password" minLength={10} required />
            </label>
            <label className="field">
              <span>Reauthentication code (when requested)</span>
              <input name="nonce" inputMode="numeric" autoComplete="one-time-code" />
            </label>
            <button type="submit">Update password</button>
          </form>
          <form action={reauthenticateAction}>
            <button type="submit" className="secondary">Send reauthentication code</button>
          </form>
        </section>

        <section className="panel">
          <h2>Sessions</h2>
          <p className="muted">
            Revoking sessions invalidates refresh tokens. Already-issued access tokens can remain valid until expiry, so sensitive company commands still recheck live membership.
          </p>
          <div className="actions">
            <form action={signOutAction}>
              <input type="hidden" name="scope" value="local" />
              <button type="submit" className="secondary">Sign out this session</button>
            </form>
            <form action={signOutAction}>
              <input type="hidden" name="scope" value="others" />
              <button type="submit" className="secondary">Revoke other sessions</button>
            </form>
            <form action={signOutAction}>
              <input type="hidden" name="scope" value="global" />
              <button type="submit">Sign out everywhere</button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
