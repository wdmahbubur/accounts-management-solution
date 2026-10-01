"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { ApiResult } from "@ams/contracts";
import type { RecipientReceipt } from "../../../server/invitations/contracts.ts";
import { respondInvitationAction } from "./actions.ts";
export function InvitationResponseForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ApiResult<RecipientReceipt> | null, FormData>(respondInvitationAction, null);
  if (state && "data" in state) return <div role="status"><p className="alert">{state.data.message}</p><Link href="/companies">Go to companies</Link></div>;
  return <form action={action} aria-label="Respond to invitation" className="settings-form">
    <input type="hidden" name="token" value={token} />
    <fieldset disabled={pending} className="mutation-fields">
      <label className="check-field"><input name="confirmed" type="checkbox" value="yes" /><span>I confirm the proposed company and role.</span></label>
      <button type="submit" name="decision" value="accept">{pending ? "Saving…" : "Accept invitation"}</button>
      <button type="submit" name="decision" value="reject">Reject invitation</button>
    </fieldset>
    {state && "error" in state && <p role="alert" className="alert">{state.error.message} {state.error.fields && Object.values(state.error.fields).join(" ")}</p>}
  </form>;
}
