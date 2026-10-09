"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ContractValidationError } from "@ams/contracts";
import { CashAccountSaveGuard, parseCashAccountInput, performCashAccountSave } from "../../../../../lib/cash-account-requests.ts";

type Row = Record<string, unknown>;
const labels: Record<string, string> = { name: "Name", kind: "Kind", account_id: "Ledger account", institution: "Institution",
  masked_account_number: "Masked account number", is_cash_equivalent: "Cash equivalents", allow_negative_balance: "Negative balance", body: "Account details" };

export function CashAccounts({ organizationId, rows, options, canWrite }: { organizationId: string; rows: Row[]; options: Row[]; canWrite: boolean }) {
  const router = useRouter(), prefix = useId();
  const formRef = useRef<HTMLFormElement>(null), errorRef = useRef<HTMLDivElement>(null);
  const guard = useRef(new CashAccountSaveGuard()), pending = useRef(false);
  const [busy, setBusy] = useState<"create" | "archive" | null>(null);
  const [error, setError] = useState(""), [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [recovering, setRecovering] = useState(false), [dirty, setDirty] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty && !recovering) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, recovering]);
  const focusError = () => requestAnimationFrame(() => errorRef.current?.focus());
  const control = (name: string) => ({ name, "aria-invalid": Boolean(fieldErrors[name]), "aria-describedby": fieldErrors[name] ? `${prefix}-${name}-error` : undefined });
  const fieldError = (name: string) => fieldErrors[name] ? <small id={`${prefix}-${name}-error`} role="note">{fieldErrors[name]}</small> : null;

  async function create(form?: FormData) {
    if (pending.current) return;
    try {
      const input = form ? parseCashAccountInput({ name: form.get("name"), kind: form.get("kind"), account_id: form.get("account_id"),
        institution: form.get("institution"), masked_account_number: form.get("masked_account_number"),
        is_cash_equivalent: form.get("is_cash_equivalent") === "on", allow_negative_balance: form.get("allow_negative_balance") === "on" }) : undefined;
      const attempt = guard.current.begin(input);
      if (!attempt) return;
      pending.current = true; setBusy("create"); setError(""); setFieldErrors({}); setSavedId(null);
      const outcome = await performCashAccountSave(organizationId, attempt);
      guard.current.finish(outcome); setRecovering(guard.current.needsRecovery);
      if (outcome.kind === "confirmed") {
        setSavedId(outcome.id); setDirty(false); formRef.current?.reset(); router.refresh();
      } else if (outcome.kind === "rejected") {
        setError(outcome.message); setFieldErrors(outcome.fields); focusError();
      } else {
        setError("The save result is unconfirmed. Your submitted details are preserved. Check the saved account before retrying the same details."); focusError();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Check the account details.");
      if (failure instanceof ContractValidationError) setFieldErrors({ ...failure.fields });
      focusError();
    } finally { pending.current = false; setBusy(null); }
  }

  async function archive(id: string) {
    if (pending.current || recovering) return;
    pending.current = true; setBusy("archive"); setError(""); setFieldErrors({}); setSavedId(null);
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/cash-accounts/${id}`, { method: "PATCH" });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "Could not archive the account.");
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not archive the account."); focusError(); }
    finally { pending.current = false; setBusy(null); }
  }

  return <main className="content"><p className="eyebrow">Banking</p><h1>Cash and bank accounts</h1>
    <p>Balances come from posted ledger entries. Opening balances are entered through an opening journal; this setup has no editable balance field. Wallet entries do not connect to provider APIs.</p>
    <p>{canWrite && <Link href={`/o/${organizationId}/banking/import`}>Import a bank statement</Link>} {rows.length > 0 && <Link href={`/o/${organizationId}/banking/reconciliations`}>Reconcile a statement</Link>}</p>
    {error && <div ref={errorRef} tabIndex={-1} role="alert"><strong>{error}</strong>{Object.entries(fieldErrors).length > 0 && <ul>{Object.entries(fieldErrors).map(([name, message]) => <li key={name}>
      <button type="button" className="secondary" onClick={() => { const field = formRef.current?.elements.namedItem(name); if (field instanceof HTMLElement) field.focus(); }}>{labels[name] ?? "Account details"}: {message}</button>
    </li>)}</ul>}</div>}
    {savedId && <p role="status">Account saved. <Link href={`/o/${organizationId}/banking/accounts/${savedId}`}>Open the account ledger</Link></p>}
    {recovering && <p role="status">The entered details are locked until the result is checked. <button type="button" disabled={busy !== null} onClick={() => void create()}>{busy === "create" ? "Checking…" : "Check save and retry"}</button></p>}
    <section className="panel"><h2>Accounts</h2>{rows.length === 0 ? <p>No cash, bank or wallet accounts configured.</p> : <div className="table-scroll"><table><thead><tr><th>Name</th><th>Kind</th><th>Ledger account</th><th>Book balance (BDT)</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{rows.map(row => <tr key={String(row.id)}><td><Link href={`/o/${organizationId}/banking/accounts/${String(row.id)}`}>{String(row.name)}</Link></td><td>{String(row.kind).replaceAll("_", " ")}</td><td>{String(row.account_code)} · {String(row.account_name)}</td><td>{String(row.book_balance)}</td><td>{row.is_active ? "Active" : "Archived"}</td><td>{canWrite && row.is_active ? <button type="button" className="secondary" disabled={busy !== null || recovering} onClick={() => void archive(String(row.id))}>Archive</button> : "—"}</td></tr>)}</tbody>
    </table></div>}</section>
    {canWrite && <section className="panel"><h2>Add cash, bank or wallet</h2>
      <form ref={formRef} aria-busy={busy === "create"} onSubmit={event => { event.preventDefault(); void create(new FormData(event.currentTarget)); }} onChange={() => { setDirty(true); setSavedId(null); setFieldErrors({}); }}>
        <fieldset className="toolbar" disabled={busy !== null || recovering}><legend>Account details</legend>
          <label>Name<input {...control("name")} maxLength={120} required />{fieldError("name")}</label>
          <label>Kind<select {...control("kind")}><option value="cash">Physical cash</option><option value="bank">Bank</option><option value="mobile_wallet">Mobile wallet</option><option value="payment_clearing">Payment clearing</option></select>{fieldError("kind")}</label>
          <label>Ledger account<select {...control("account_id")} required><option value="">Choose an asset account</option>{options.map(option => <option key={String(option.id)} value={String(option.id)}>{String(option.code)} · {String(option.name)}</option>)}</select>{fieldError("account_id")}</label>
          <label>Institution (optional)<input {...control("institution")} maxLength={120} />{fieldError("institution")}</label>
          <label>Masked account number (optional)<input {...control("masked_account_number")} maxLength={80} autoComplete="off" />{fieldError("masked_account_number")}</label>
          <label><input {...control("is_cash_equivalent")} type="checkbox" /> Include in cash equivalents{fieldError("is_cash_equivalent")}</label>
          <label><input {...control("allow_negative_balance")} type="checkbox" /> Allow negative book balance{fieldError("allow_negative_balance")}</label>
          <button type="submit">{busy === "create" ? "Saving…" : "Add account"}</button>
        </fieldset>
      </form>
    </section>}
  </main>;
}
