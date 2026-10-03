"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Account = { id: string; name: string; kind: string };
export function ReconciliationStart({ organizationId, accounts, canWrite }: { organizationId: string; accounts: Account[]; canWrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(form: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/reconciliations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cash_account_id: form.get("account"), starts_on: form.get("starts_on"), ends_on: form.get("ends_on"), statement_opening: form.get("opening"), statement_closing: form.get("closing") }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.fields?.statement_opening ?? json?.error?.message ?? "Could not create reconciliation.");
      router.push(`/o/${organizationId}/banking/reconciliations/${json.data.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create reconciliation."); }
    finally { setBusy(false); }
  }
  return <main className="content"><p className="eyebrow">Banking</p><h1>Reconciliations</h1><p>Match statement observations to existing posted cash lines. Matching creates no ledger entry.</p>{error && <p role="alert">{error}</p>}{!accounts.length ? <section className="panel"><p>Add an active cash or bank account before reconciling.</p></section> : canWrite ? <section className="panel"><h2>Start a statement session</h2><form action={create} className="toolbar"><label>Cash or bank account<select name="account" required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.kind.replaceAll("_", " ")}</option>)}</select></label><label>Statement start<input name="starts_on" type="date" required/></label><label>Statement end<input name="ends_on" type="date" required/></label><label>Opening statement balance (BDT)<input name="opening" inputMode="decimal" pattern="-?[0-9]{1,12}\.[0-9]{2}" placeholder="0.00" required/></label><label>Closing statement balance (BDT)<input name="closing" inputMode="decimal" pattern="-?[0-9]{1,12}\.[0-9]{2}" placeholder="0.00" required/></label><button type="submit" disabled={busy}>{busy ? "Creating…" : "Create draft reconciliation"}</button></form></section> : <section className="panel"><p>You can view a reconciliation when you open its link.</p></section>}</main>;
}
