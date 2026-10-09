"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { parseUuid } from "@ams/contracts";
import type { ReconciliationAccount } from "../../../../../lib/reconciliation-history.ts";

export function ReconciliationStart({ organizationId, accounts, defaultAccountId = "", startsOn = "", endsOn = "" }: {
  organizationId: string; accounts: ReconciliationAccount[]; defaultAccountId?: string; startsOn?: string; endsOn?: string;
}) {
  const router = useRouter();
  const pending = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [startDate, setStartDate] = useState(startsOn);
  async function create(form: FormData) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setFields({});
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/reconciliations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cash_account_id: form.get("account"), starts_on: form.get("starts_on"), ends_on: form.get("ends_on"), statement_opening: form.get("opening"), statement_closing: form.get("closing") }) });
      const json = await response.json();
      if (!response.ok) {
        const details = json?.error?.fields;
        if (details && typeof details === "object" && !Array.isArray(details)) setFields(Object.fromEntries(Object.entries(details).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
        throw new Error(json?.error?.code === "RECONCILIATION_LOCKED" ? "A finalized reconciliation covers these dates. Open it from history to review or request an authorized reopen." : json?.error?.message ?? "Could not create reconciliation.");
      }
      const id = parseUuid(json?.data?.id);
      router.push(`/o/${organizationId}/banking/reconciliations/${id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create reconciliation. Your entered details are preserved.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { pending.current = false; setBusy(false); }
  }
  const fieldError = (field: string) => fields[field] ? <span id={`reconciliation-${field}-error`} role="alert">{fields[field]}</span> : null;
  const attributes = (field: string) => ({ "aria-invalid": !!fields[field], "aria-describedby": fields[field] ? `reconciliation-${field}-error` : undefined });
  return <section className="panel" aria-labelledby="reconciliation-start-title">
    <h2 id="reconciliation-start-title">Start a statement session</h2>
    <p>Use the account, dates and opening/closing balances shown on the statement. If a draft already exists for the same account and dates, it will resume with its saved balances.</p>
    {error ? <div ref={errorRef} tabIndex={-1} role="alert"><p>{error}</p>{fields.form ? <p>{fields.form}</p> : null}</div> : null}
    <form aria-busy={busy} onSubmit={event => { event.preventDefault(); void create(new FormData(event.currentTarget)); }}>
      <fieldset disabled={busy} className="toolbar"><legend>Statement details</legend>
        <label>Cash or bank account<select name="account" required defaultValue={defaultAccountId} {...attributes("cash_account_id")}><option value="">Choose an account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.kind.replaceAll("_", " ")}</option>)}</select>{fieldError("cash_account_id")}</label>
        <label>Statement start<input name="starts_on" type="date" required value={startDate} onChange={event => setStartDate(event.target.value)} {...attributes("starts_on")}/>{fieldError("starts_on")}</label>
        <label>Statement end<input name="ends_on" type="date" required min={startDate || undefined} defaultValue={endsOn} {...attributes("ends_on")}/>{fieldError("ends_on")}</label>
        <label>Opening statement balance (BDT)<input name="opening" inputMode="decimal" pattern="-?[0-9]{1,12}[.][0-9]{2}" placeholder="0.00" required {...attributes("statement_opening")}/>{fieldError("statement_opening")}</label>
        <label>Closing statement balance (BDT)<input name="closing" inputMode="decimal" pattern="-?[0-9]{1,12}[.][0-9]{2}" placeholder="0.00" required {...attributes("statement_closing")}/>{fieldError("statement_closing")}</label>
        <button type="submit">{busy ? "Opening session…" : "Start or resume reconciliation"}</button>
      </fieldset>
    </form>
  </section>;
}
