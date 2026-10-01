"use client";
import { useActionState, useEffect, useId, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ApiResult } from "@ams/contracts";
import type { InvitationOperation, InvitationReceipt, InvitationRow } from "../../../../server/invitations/contracts.ts";
import type { ManagedRole } from "../../../../server/roles/contracts.ts";
import styles from "./invitations-panel.module.css";
import { manageInvitationAction } from "./invitation-actions.ts";
function InvitationForm({ organizationId, nonce, operation, invitationId, label, children, rows }: {
  organizationId: string; nonce: string; operation: InvitationOperation; invitationId?: string; label: string; children?: ReactNode; rows?: InvitationRow[];
}) {
  const [state, action, pending] = useActionState<ApiResult<InvitationReceipt> | null, FormData>(manageInvitationAction, null);
  const router = useRouter();
  useEffect(() => { if (state && "data" in state) router.refresh(); }, [state, router]);
  return <form action={action} aria-label={label} className="settings-form">
    <input type="hidden" name="company" value={organizationId} /><input type="hidden" name="company_context" value={nonce} />
    <input type="hidden" name="operation" value={operation} />
    {invitationId && <input type="hidden" name="invitation_id" value={invitationId} />}
    <fieldset disabled={pending} className="mutation-fields">{children}<button type="submit">{pending ? "Saving…" : label}</button></fieldset>
    {state && "error" in state && <p className="alert" role="alert">{state.error.message} {state.error.fields && Object.values(state.error.fields).join(" ")}</p>}
    {state && "data" in state && <div className="alert" role="status"><p>{state.data.message}</p>
      {state.data.invitationPath && (!rows || rows.some((row) => row.id === state.data.invitationId && row.generation === 1 && row.status === "pending")) && <p><a href={state.data.invitationPath} rel="noreferrer" referrerPolicy="no-referrer">One-time invitation link</a></p>}
    </div>}
  </form>;
}
export function InvitationsPanel({ organizationId, nonce, roles, invitations, canManage }: {
  organizationId: string; nonce: string; roles: ManagedRole[]; invitations: InvitationRow[]; canManage: boolean;
}) {
  const id = useId();
  return <section className={styles.section} aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Invitations</h2>
    <p>Only the intended verified email can join. Links expire after 72 hours and work once. Resending replaces the old link.</p>
    {canManage && <section className="panel"><h3>Invite a colleague</h3>
      <InvitationForm operation="create" organizationId={organizationId} nonce={nonce} label="Create invitation" rows={invitations}>
        <div className="field"><label htmlFor={`${id}-email`}>Recipient email</label><input id={`${id}-email`} type="email" name="email" required maxLength={254} autoComplete="off" /></div>
        <div className="field"><label htmlFor={`${id}-role`}>Proposed role</label><select id={`${id}-role`} name="role_id" required defaultValue="">
          <option value="" disabled>Select a role you can grant</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </select></div>
      </InvitationForm>
      <p className="muted">Delivery is queued, not confirmed sent. Copy the one-time link to share securely; refresh removes that link from this screen.</p>
    </section>}
    <div className="management-grid">{invitations.length === 0 && <p>No invitations yet.</p>}
      {invitations.map((invite) => <article className="panel" key={invite.id}>
        <h3>{invite.email}</h3><p>{invite.roleName} · <strong>{invite.status}</strong></p>
        <p>Expires <time dateTime={invite.expiresAt}>{new Date(invite.expiresAt).toISOString().replace("T", " ").slice(0, 16)} UTC</time></p>
        {canManage && roles.some((role) => role.id === invite.roleId) && ["pending", "expired"].includes(invite.status) && <>
          <InvitationForm operation="resend" organizationId={organizationId} nonce={nonce} invitationId={invite.id} label={`Resend invitation to ${invite.email}`} />
          <details><summary>Revoke invitation to {invite.email}</summary>
            <InvitationForm operation="revoke" organizationId={organizationId} nonce={nonce} invitationId={invite.id} label={`Revoke invitation to ${invite.email}`}>
              <label className="check-field"><input type="checkbox" required name="confirmed" value="yes" /><span>I confirm this link should stop working.</span></label>
            </InvitationForm>
          </details>
        </>}
      </article>)}
    </div>
  </section>;
}
