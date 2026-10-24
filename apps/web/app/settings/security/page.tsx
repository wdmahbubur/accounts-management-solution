import { redirect } from "next/navigation";
import { AccountShell } from "../../../components/shell/account-shell.tsx";
import styles from "../../auth/account-pages.module.css";

import { auth } from "../../../../../auth.ts";
import {
  reauthenticateAction,
  signOutAction,
  updatePasswordAction
} from "../../auth/actions.ts";
import { hasRecentAuthentication } from "../../../server/auth/recent-auth.ts";
import { DEMO_ACCOUNT_EMAIL } from "../../../server/auth/demo-login.ts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const dynamic = "force-dynamic";

export default async function SecurityPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();
  const user = session?.user?.id ? session.user : null;

  if (!user) {
    redirect("/auth/sign-in?next=/settings/security");
  }

  const params = await searchParams;
  const status = first(params.status);
  const error = first(params.error);
  const recent = hasRecentAuthentication(user.recentAuthAt);
  const sharedDemoAccount = user.email?.trim().toLowerCase() === DEMO_ACCOUNT_EMAIL;

  return (
    <AccountShell title="Security" eyebrow="Personal settings" description="Manage your password and signed-in sessions." settingsPage="security" wide backHref="/companies" backLabel="Back to companies">
      <div className={styles.securityGrid}>
        <section className={`panel ${styles.wide}`}>
          <h2>Account</h2>
          <dl className={styles.accountFacts}><div><dt>Email</dt><dd>{user.email ?? "Verified account"}</dd></div><div><dt>Recent authentication</dt><dd>{recent ? "Confirmed" : "Required for sensitive changes"}</dd></div></dl>
          {status === "reauth_requested" ? <p className="alert" role="status">Check your verified email and open the confirmation link before changing security settings.</p> : null}
          {status === "reauthenticated" ? <p className="alert" role="status">Recent authentication confirmed.</p> : null}
          {status === "password_changed" ? <p className="alert" role="status">Password changed. Sign in again with the new password.</p> : null}
          {error === "password_policy" ? (
            <p className="alert" role="alert">Use at least 10 characters with uppercase, lowercase and a number.</p>
          ) : error === "recent_auth_required" ? (
            <p className="alert" role="alert">Confirm your current password again before changing it.</p>
          ) : error === "reauthentication_failed" ? (
            <p className="alert" role="alert">The current password was not accepted for this session.</p>
          ) : error === "shared_demo_account" ? (
            <p className="alert" role="alert">The shared demo password is fixed so other visitors can sign in.</p>
          ) : error ? (
            <p className="alert" role="alert">The security action could not be completed. Reauthenticate and try again.</p>
          ) : null}
        </section>

        <section className="panel">
          <h2>Confirm this session</h2>
          <p className={styles.help}>Confirm your current password before making sensitive changes.</p>
          <form action={reauthenticateAction} className="settings-form">
            <label className="field">
              <span>Current password</span>
              <input name="current_password" type="password" autoComplete="current-password" required />
            </label>
            <button type="submit" className="secondary">Confirm this session</button>
          </form>
        </section>

        <section className="panel">
          <h2>Change password</h2>
          {sharedDemoAccount ? (
            <p className="muted">This shared demo account keeps the published sign-in credentials fixed.</p>
          ) : (
            <form action={updatePasswordAction} className="settings-form">
              <label className="field">
                <span>New password</span>
                <input name="password" type="password" autoComplete="new-password" minLength={10} required aria-describedby="security-password-help" />
                <small id="security-password-help" className={styles.help}>At least 10 characters, including uppercase, lowercase and a number.</small>
              </label>
              <button type="submit">Update password</button>
            </form>
          )}
        </section>

        <section className={`panel ${styles.wide}`}>
          <h2>Sessions</h2>
          <p className={styles.help}>Sign out here, revoke access on other devices, or end every session.</p>
          <div className={styles.actions}>
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
          <details className={styles.details}><summary>How session revocation works</summary><p>Revoking sessions invalidates refresh tokens. Already-issued access tokens can remain valid until expiry, so sensitive company commands still recheck live membership.</p></details>
        </section>
      </div>
    </AccountShell>
  );
}
