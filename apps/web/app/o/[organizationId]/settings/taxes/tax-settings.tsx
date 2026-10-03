"use client";
import { useMemo, useState } from "react";
import { calculateLine } from "@ams/accounting";
import { bangladeshDate } from "../../../../../lib/date.ts";
import type { TaxCatalog, TaxCode, TaxKind } from "../../../../../server/taxes/contracts.ts";
import styles from "./tax-settings.module.css";

const kindLabels: Record<TaxKind, string> = { standard: "Standard rate", zero_rated: "Zero rated", exempt: "Exempt", out_of_scope: "Out of scope" };
type Props = { organizationId: string; nonce: string; catalog: TaxCatalog; canManage: boolean };
export function TaxSettings({ organizationId, nonce, catalog, canManage }: Props) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState(catalog.codes.find((code) => code.isActive)?.id ?? "");
  const [versionCode, setVersionCode] = useState(""); const [existingVersion, setExistingVersion] = useState("new");
  const [mode, setMode] = useState<"exclusive" | "inclusive">("exclusive"); const [amount, setAmount] = useState("10000");
  const selected = catalog.codes.find((code) => code.id === selectedId);
  const latest = useMemo(() => new Map(catalog.codes.reduce<TaxCode[]>((all, code) => {
    const existing = all.find((row) => row.code === code.code);
    if (!existing || existing.versionNo < code.versionNo) return [...all.filter((row) => row.code !== code.code), code];
    return all;
  }, []).map((code) => [code.code, code])), [catalog.codes]);
  const sample = useMemo(() => {
    if (!selected || !/^\d+(?:\.\d{1,2})?$/.test(amount)) return null;
    try { return calculateLine({ quantity: "1", unit_price: amount, discount_amount: "0.00", tax_rate: selected.ratePercent, tax_mode: mode }); }
    catch { return null; }
  }, [selected, amount, mode]);
  const outputAccounts = catalog.accounts.filter((account) => account.mappingKey === "output_tax");
  const inputAccounts = catalog.accounts.filter((account) => account.mappingKey === "input_tax");
  async function send(path: string, method: string, payload: unknown) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/${path}`, { method, headers: { "Content-Type": "application/json", "X-Request-Id": `tax-${crypto.randomUUID()}` }, body: JSON.stringify(payload) });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.fields?.tax ?? json?.error?.fields?.rate_percent ?? json?.error?.message ?? "Could not save tax settings.");
      setMessage("Tax settings saved. Refreshing the current company configuration."); window.location.reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save tax settings."); }
    finally { setBusy(false); }
  }
  async function createVersion(form: FormData) {
    const rate = String(form.get("rate_percent") ?? "0");
    const existing = String(form.get("existing_code_version") ?? "new");
    await send("tax-codes", "POST", { code: String(form.get("code") ?? ""), label: String(form.get("label") ?? ""), rate_percent: rate,
      tax_kind: String(form.get("tax_kind") ?? "standard"), output_account_id: String(form.get("output_account_id") ?? "") || null,
      input_account_id: String(form.get("input_account_id") ?? "") || null, recoverability: String(form.get("recoverability") ?? "none"),
      effective_from: String(form.get("effective_from") ?? ""), effective_to: String(form.get("effective_to") ?? "") || null,
      expected_latest_row_version: existing === "new" ? 0 : Number(existing.split(":").at(-1)), reason: String(form.get("reason") ?? "") });
  }
  return <main className={styles.main} data-company-context={nonce}>
    <p className="eyebrow">Company settings</p><h1>Tax configuration</h1>
    <aside className={styles.warning}><strong>Configuration only</strong><p>Rates and treatments are entered by your company. This screen does not determine statutory rates or certify filing compliance. Confirm the applicable treatment before using a tax code on a document.</p></aside>
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.notice}>{message}</p>}
    {canManage && <section className={`panel ${styles.panel}`}><h2>Create a tax-code version</h2><p>Versions are effective dated. Saving a new version does not rewrite documents that already hold tax snapshots.</p>
      <form action={createVersion} className={styles.form}>
        <label>Code<input name="code" required maxLength={32} placeholder="Company-defined code" value={versionCode} onChange={(event) => { setVersionCode(event.target.value.toUpperCase()); setExistingVersion("new"); }} /></label>
        <label>Label<input name="label" required maxLength={160} /></label>
        <label>Rate (%)<input name="rate_percent" required inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,6})?" defaultValue="0" /></label>
        <label>Tax treatment<select name="tax_kind" defaultValue="standard">{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Purchase tax recovery<select name="recoverability" defaultValue="none"><option value="none">Nonrecoverable</option><option value="full">Fully recoverable</option></select></label>
        <label>Output-tax account<select name="output_account_id" defaultValue=""><option value="">No account</option>{outputAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
        <label>Input-tax account<select name="input_account_id" defaultValue=""><option value="">No account</option>{inputAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
        <label>Effective from<input name="effective_from" type="date" required defaultValue={bangladeshDate()} /></label>
        <label>Effective to (optional)<input name="effective_to" type="date" /></label>
        <label>Reason for this version<input name="reason" required minLength={10} maxLength={1000} /></label>
        <label>Current latest version (for an existing code)<select name="existing_code_version" value={existingVersion} onChange={(event) => { setExistingVersion(event.target.value); const code = [...latest.values()].find((item) => `${item.code}:${item.rowVersion}` === event.target.value); if (code) setVersionCode(code.code); }}>
          <option value="new">New code (no earlier version)</option>{[...latest.values()].map((code) => <option key={code.code} value={`${code.code}:${code.rowVersion}`}>{code.code} · latest v{code.versionNo}</option>)}
        </select></label>
        <p className={styles.hint}>Choose a current version to continue that code&apos;s history. The server checks the version again before saving.</p>
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Create version"}</button>
      </form>
    </section>}
    <section className={`panel ${styles.panel}`}><h2>Tax codes and history</h2>
      {catalog.codes.length === 0 ? <p>No tax codes are configured. Add a version using a company-approved treatment.</p> : <div className={styles.tableWrap}><table><thead><tr><th>Code/version</th><th>Label and treatment</th><th>Rate</th><th>Accounts and recovery</th><th>Effective dates</th><th>Status</th>{canManage && <th>Action</th>}</tr></thead><tbody>
        {catalog.codes.map((code) => <tr key={code.id}><td>{code.code} · v{code.versionNo}</td><td>{code.label}<small>{kindLabels[code.taxKind]}</small></td><td>{code.ratePercent}%</td><td>Output: {code.outputAccountLabel ?? "—"}<small>Input: {code.inputAccountLabel ?? "—"} · {code.recoverability === "full" ? "recoverable" : "nonrecoverable"}</small></td><td>{code.effectiveFrom} to {code.effectiveTo ?? "open"}</td><td>{code.isActive ? "Active" : "Archived"}</td><td>{canManage && code.isActive && <button type="button" className="secondary" disabled={busy} onClick={() => void send("tax-codes/archive", "POST", { tax_code_id: code.id, expected_row_version: code.rowVersion, reason: "Company retired this tax-code version." })}>Archive</button>}</td></tr>)}
      </tbody></table></div>}
    </section>
    <section className={`panel ${styles.panel}`}><h2>Sample calculation</h2><p>Preview only. Select an existing version; the selected inclusive or exclusive mode is stored with each document line.</p>
      {catalog.codes.length === 0 ? <p>Add a tax-code version to preview its configured rate.</p> : <div className={styles.sample}>
        <label>Tax code<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{catalog.codes.map((code) => <option key={code.id} value={code.id}>{code.code} v{code.versionNo} · {code.label} ({code.ratePercent}%) {code.isActive ? "" : "· archived"}</option>)}</select></label>
        <label>Entered amount (BDT)<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" /></label>
        <label>Amount includes tax?<select value={mode} onChange={(event) => setMode(event.target.value as "exclusive" | "inclusive")}><option value="exclusive">No, exclusive</option><option value="inclusive">Yes, inclusive</option></select></label>
        {sample && <dl><div><dt>Net</dt><dd>{sample.net}</dd></div><div><dt>Tax</dt><dd>{sample.tax}</dd></div><div><dt>Gross</dt><dd>{sample.gross}</dd></div></dl>}
      </div>}
    </section>
  </main>;
}
