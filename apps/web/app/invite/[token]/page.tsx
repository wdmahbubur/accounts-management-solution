import Link from "next/link";
import { redirect } from "next/navigation";
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
    try { invitationToken(token); } catch { return <main><h1>Invitation unavailable</h1><p>Request a new invitation.</p></main>; }
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  }
  let invite;
  try { invite = await inspectInvitation(client, token); }
  catch (error) {
    if (!(error instanceof CommandError) || !["NOT_FOUND", "FORBIDDEN"].includes(error.code)) throw error;
    return <main><h1>Invitation unavailable</h1><p>Use the intended verified email account, or ask an authorized company administrator for a fresh link.</p>
      <p><Link href={`/auth/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in with another account</Link></p><Link href="/companies">Go to companies</Link></main>;
  }
  return <main><p className="eyebrow">Verified company invitation</p><h1>Join {invite.organizationName}</h1>
    <p>Proposed role: <strong>{invite.roleName}</strong></p>
    <p>This invitation is for your currently verified email. It cannot be transferred to another account.</p>
    <p>Expires <time dateTime={invite.expiresAt}>{new Date(invite.expiresAt).toISOString().slice(0, 16).replace("T", " ")} UTC</time>.</p>
    <InvitationResponseForm token={token} />
  </main>;
}
