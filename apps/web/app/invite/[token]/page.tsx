import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell } from "../../../components/shell/account-shell.tsx";
import styles from "../../auth/account-pages.module.css";
import { createClient } from "../../../lib/database/server.ts";
import { CommandError } from "../../../server/commands/errors.ts";
import { invitationToken } from "../../../server/invitations/contracts.ts";
import { inspectInvitation } from "../../../server/invitations/service.ts";
import { InvitationResponseForm } from "./response-form.tsx";
export const metadata = { title: "Company invitation", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) {
    try { invitationToken(token); } catch { return <AccountShell title="Invitation unavailable" eyebrow="Company invitation"><section className="panel"><p role="alert">Request a new invitation.</p><Link href="/auth/sign-in">Back to sign in</Link></section></AccountShell>; }
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  }
  let invite;
  try { invite = await inspectInvitation(client, token); }
  catch (error) {
    if (!(error instanceof CommandError) || !["NOT_FOUND", "FORBIDDEN"].includes(error.code)) throw error;
    return <AccountShell title="Invitation unavailable" eyebrow="Company invitation" backHref="/companies" backLabel="Back to companies"><section className="panel"><p role="alert">Use the intended verified email account, or ask an authorized company administrator for a fresh link.</p>
      <div className={styles.actions}><Link className="secondary" href={`/auth/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in with another account</Link><Link href="/companies">Go to companies</Link></div></section></AccountShell>;
  }
  return <AccountShell title={`Join ${invite.organizationName}`} eyebrow="Verified company invitation" backHref="/companies" backLabel="Back to companies"><section className="panel">
    <dl className={styles.facts}><div><dt>Proposed role</dt><dd>{invite.roleName}</dd></div><div><dt>Invitation expires</dt><dd><time dateTime={invite.expiresAt}>{new Intl.DateTimeFormat("en-GB", {dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(invite.expiresAt))} UTC</time></dd></div></dl>
    <p className={styles.help}>This invitation is for your currently verified email. It cannot be transferred to another account.</p>
    <InvitationResponseForm token={token} />
  </section></AccountShell>;
}
