"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ContractValidationError } from "@ams/contracts";
import { CashAccountSaveGuard, parseCashAccountInput, performCashAccountSave } from "../../../../../lib/cash-account-requests.ts";
import styles from "../banking.module.css";

type Row = Record<string, unknown>;
const labels: Record<string, string> = { name: "Name", kind: "Kind", account_id: "Ledger account", institution: "Institution",
  masked_account_number: "Masked account number", is_cash_equivalent: "Cash equivalents", allow_negative_balance: "Negative balance", body: "Account details" };

export function CashAccounts({ organizationId, rows, options, canWrite }: { organizationId: string; rows: Row[]; options: Row[]; canWrite: boolean }) {
  const router = useRouter(), prefix = useId();
  const formRef = useRef<HTMLFormElement>(null), errorRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const guard = useRef(new CashAccountSaveGuard()), pending = useRef(false);
  const [busy, setBusy] = useState<"create" | "archive" | null>(null);
  const [error, setError] = useState(""), [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [recovering, setRecovering] = useState(false), [dirty, setDirty] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  useEffect(() => {
    if ((error || recovering) && detailsRef.current) detailsRef.current.open = true;
  }, [error, recovering]);
  useEffect(() => {
    if (!dirty && !recovering) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, recovering]);
  const focusError = () => requestAnimationFrame(() => errorRef.current?.focus());
  const control = (name: string) => ({ name, "aria-invalid": Boolean(fieldErrors[name]), "aria-describedby": fieldErrors[name] ? `${prefix}-${name}-error` : undefined });
  const fieldError = (name: string) => fieldErrors[name] ? <small className={styles.fieldError} id={`${prefix}-${name}-error`} role="note">{fieldErrors[name]}</small> : null;

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

  return <main className="content"><header className={styles.heading}><div><p className="eyebrow">Banking</p><h1>Cash and bank accounts</h1><p className={styles.metadata}>Posted book balances in BDT.</p></div>
      <div className={styles.actions}>{canWrite && <Link className="secondary" href={`/o/${organizationId}/banking/import`}>Import statement</Link>}{rows.length > 0 && <Link className="secondary" href={`/o/${organizationId}/banking/reconciliations`}>Reconcile statement</Link>}</div>
    </header>
    {error && <div className={styles.error} ref={errorRef} tabIndex={-1} role="alert"><strong>{error}</strong>{Object.entries(fieldErrors).length > 0 && <ul>{Object.entries(fieldErrors).map(([name, message]) => <li key={name}>
      <button type="button" className="secondary" onClick={() => { if (detailsRef.current) detailsRef.current.open = true; const field = formRef.current?.elements.namedItem(name); if (field instanceof HTMLElement) field.focus(); }}>{labels[name] ?? "Account details"}: {message}</button>
    </li>)}</ul>}</div>}
    {savedId && <p className={styles.success} role="status">Account saved. <Link href={`/o/${organizationId}/banking/accounts/${savedId}`}>Open the account ledger</Link></p>}
    {recovering && <div className={styles.notice} role="status"><p>The entered details are locked until the result is checked.</p><div className={styles.actions}><button type="button" disabled={busy !== null} onClick={() => void create()}>{busy === "create" ? "Checking…" : "Check save and retry"}</button></div></div>}
    <section className="panel"><h2>Accounts</h2>{rows.length === 0 ? <p className={styles.muted}>No cash, bank or wallet accounts configured.</p> : <div className="table-scroll"><table><thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Ledger account</th><th scope="col" className={styles.number}>Book balance · BDT</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
      <tbody>{rows.map(row => <tr key={String(row.id)}><td><Link href={`/o/${organizationId}/banking/accounts/${String(row.id)}`}>{String(row.name)}</Link></td><td>{String(row.kind).replaceAll("_", " ")}</td><td>{String(row.account_code)} · {String(row.account_name)}</td><td className={styles.number}>{String(row.book_balance)}</td><td><span className={styles.badge}>{row.is_active ? "Active" : "Archived"}</span></td><td>{canWrite && row.is_active ? <button type="button" className="secondary" disabled={busy !== null || recovering} onClick={() => void archive(String(row.id))}>Archive</button> : "—"}</td></tr>)}</tbody>
    </table></div>}</section>
    {canWrite && <details ref={detailsRef} className={styles.details} open={rows.length === 0}><summary>Add account</summary><div className={styles.detailsBody}>
      <p className={styles.muted}>Add a cash, bank or wallet account linked to your asset ledger.</p>
      <form ref={formRef} aria-busy={busy === "create"} onSubmit={event => { event.preventDefault(); void create(new FormData(event.currentTarget)); }} onChange={() => { setDirty(true); setSavedId(null); setFieldErrors({}); }}>
        <fieldset className={styles.fieldSet} disabled={busy !== null || recovering}><legend className={styles.srOnly}>Account details</legend><div className={styles.grid}>
          <label>Name<input {...control("name")} maxLength={120} required />{fieldError("name")}</label>
          <label>Kind<select {...control("kind")}><option value="cash">Physical cash</option><option value="bank">Bank</option><option value="mobile_wallet">Mobile wallet</option><option value="payment_clearing">Payment clearing</option></select>{fieldError("kind")}</label>
          <label>Ledger account<select {...control("account_id")} required><option value="">Choose an asset account</option>{options.map(option => <option key={String(option.id)} value={String(option.id)}>{String(option.code)} · {String(option.name)}</option>)}</select>{fieldError("account_id")}</label>
          <label>Institution (optional)<input {...control("institution")} maxLength={120} />{fieldError("institution")}</label>
          <label>Masked account number (optional)<input {...control("masked_account_number")} maxLength={80} autoComplete="off" />{fieldError("masked_account_number")}</label>
        </div><div className={styles.stack}>
          <div><label className="check-field"><input {...control("is_cash_equivalent")} type="checkbox" /> Include in cash equivalents</label>{fieldError("is_cash_equivalent")}</div>
          <div><label className="check-field"><input {...control("allow_negative_balance")} type="checkbox" /> Allow negative book balance</label>{fieldError("allow_negative_balance")}</div>
        </div><div className={styles.formFooter}>
          <button type="submit">{busy === "create" ? "Saving…" : "Add account"}</button><p className={styles.muted}>Enter opening balances through an opening journal.</p>
        </div>
        </fieldset>
      </form>
      <p className={styles.muted}>Wallet accounts record transactions here; they do not connect to a provider.</p>
    </div></details>}
  </main>;
}
