"use client";
import { AccountShell } from "../../../components/shell/account-shell.tsx";
export default function InvitationError({ reset }: { reset: () => void }) { return <AccountShell title="Invitation could not be loaded" eyebrow="Company invitation"><section className="panel"><p role="alert">Please retry. No access has been changed.</p><button type="button" onClick={reset}>Try again</button></section></AccountShell>; }
