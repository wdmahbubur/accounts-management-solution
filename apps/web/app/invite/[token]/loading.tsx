import { AccountShell } from "../../../components/shell/account-shell.tsx";
export default function LoadingInvitation() { return <AccountShell title="Checking invitation…" eyebrow="Company invitation"><section className="panel" aria-busy="true" role="status"><p>Loading the company and role for this invitation.</p></section></AccountShell>; }
