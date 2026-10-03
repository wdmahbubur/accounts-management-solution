"use client";

import Link from "next/link";
import { useState } from "react";

type Row = Record<string, unknown>;
type Preview = { headers: string[]; preview: unknown[][]; row_count: number; valid_count: number; errors: { row_no: number; message: string }[]; file_sha256: string; repeated_fingerprint_groups: number; prior_fingerprint_groups: number };
const emptyMapping = () => ({ date: "", description: "", amount: "", debit: "", credit: "", valueDate: "", balance: "", reference: "" });

export function StatementImport({ organizationId, accounts }: { organizationId: string; accounts: Row[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [account, setAccount] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>(emptyMapping);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Row | null>(null);

  function formData(action: "inspect" | "preview" | "import") {
    const form = new FormData();
    if (file) form.set("file", file);
    form.set("cash_account_id", account);
    form.set("mapping", JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, value]) => value !== "").map(([key, value]) => [key, Number(value)]))));
    form.set("action", action);
    return form;
  }
  async function previewFile() {
    setBusy(true); setError(""); setPreview(null); setResult(null);
    try {
      const action = headers.length ? "preview" : "inspect";
      const response = await fetch(`/api/v1/organizations/${organizationId}/bank-imports`, { method: "POST", body: formData(action) });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.fields?.mapping ?? json?.error?.fields?.file ?? json?.error?.fields?.body ?? json?.error?.message ?? "Could not preview statement.");
      setHeaders(json.data.headers);
      const saved = localStorage.getItem(mappingStorageKey(json.data.headers));
      if (saved && action === "inspect") {
        try { setMapping((old) => ({ ...old, ...(JSON.parse(saved) as Record<string, string>) })); }
        catch { localStorage.removeItem(mappingStorageKey(json.data.headers)); }
      }
      if (action === "preview") setPreview(json.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not preview statement."); }
    finally { setBusy(false); }
  }
  function mappingStorageKey(sourceHeaders: string[]) { return `ams-bank-import:${organizationId}:${account}:${JSON.stringify(sourceHeaders.map((header) => header.trim().toLocaleLowerCase()))}`; }
  function saveMapping() {
    if (!headers.length || !mapping.date || !mapping.description || (!mapping.amount && (!mapping.debit || !mapping.credit))) return;
    localStorage.setItem(mappingStorageKey(headers), JSON.stringify(mapping));
  }
  async function importFile() {
    if (!preview || preview.errors.length || !file) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/bank-imports`, { method: "POST", body: formData("import") });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.fields?.rows ?? json?.error?.message ?? "Could not import statement.");
      setResult(json.data); setPreview(null); setFile(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import statement."); }
    finally { setBusy(false); }
  }
  const columnSelect = (key: string, label: string, required = false) => <label key={key}>{label}{required && " *"}<select value={mapping[key] ?? ""} onChange={(event) => { setMapping((old) => ({ ...old, [key]: event.target.value })); setPreview(null); }}><option value="">Choose a column</option>{headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}</select></label>;

  return <main className="content"><p className="eyebrow">Banking</p><h1>Import bank statement</h1><p>Upload one UTF-8 CSV or single sheet XLSX file. Imported rows are statement evidence only; importing does not create ledger entries.</p>
    {error && <p role="alert">{error}</p>}{result && <section className="panel" role="status"><h2>Import saved</h2><p>{String(result.row_count)} rows imported. Fingerprint matches need review: {String(result.review_count ?? 0)}.</p><p>General ledger and cash book were not changed by this import.</p></section>}
    {!accounts.length && <section className="panel"><p>Create an active cash or bank account before importing.</p><Link href={`/o/${organizationId}/banking/accounts`}>Open cash and bank accounts</Link></section>}
    {!!accounts.length && <><section className="panel"><h2>1. Choose file and account</h2><div className="toolbar"><label>Cash or bank account<select value={account} onChange={(event) => { setAccount(event.target.value); setHeaders([]); setMapping(emptyMapping()); setPreview(null); }} required><option value="">Choose an account</option>{accounts.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)} · {String(item.kind).replaceAll("_", " ")}</option>)}</select></label><label>CSV or XLSX file<input type="file" accept=".csv,.xlsx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setHeaders([]); setMapping(emptyMapping()); setPreview(null); setResult(null); }} required/></label></div></section>
      <section className="panel"><h2>2. Map statement columns</h2><p>Choose a signed amount, or separate debit and credit columns. Debit reduces the bank balance; credit increases it.</p>{headers.length > 0 && <div className="toolbar">{columnSelect("date", "Transaction date", true)}{columnSelect("description", "Description", true)}{columnSelect("amount", "Signed amount")}{columnSelect("debit", "Debit")}{columnSelect("credit", "Credit")}{columnSelect("valueDate", "Value date")}{columnSelect("balance", "Balance after row")}{columnSelect("reference", "Bank transaction reference")}</div>}<button type="button" disabled={busy || !file || !account} onClick={() => void previewFile()}>{busy ? "Working…" : headers.length ? "Preview rows" : "Read file columns"}</button></section>
      {preview && <section className="panel"><h2>3. Review before import</h2><p>{preview.valid_count} valid rows · {preview.errors.length} row errors · file SHA-256 {preview.file_sha256.slice(0, 16)}…</p>{(preview.repeated_fingerprint_groups + preview.prior_fingerprint_groups) > 0 && <p role="status">Review {preview.repeated_fingerprint_groups} repeated group(s) in this file and {preview.prior_fingerprint_groups} group(s) matching an earlier statement. All rows will be retained; matching rows will be flagged for review.</p>}{preview.errors.length > 0 && <div role="alert"><h3>Correct these rows and preview again</h3><ul>{preview.errors.map((item) => <li key={item.row_no}>Row {item.row_no}: {item.message}</li>)}</ul></div>}<div className="table-scroll"><table><thead><tr>{preview.headers.map((header, i) => <th key={i}>{header || `Column ${i + 1}`}</th>)}</tr></thead><tbody>{preview.preview.slice(1).map((row, i) => <tr key={i}>{preview.headers.map((_, column) => <td key={column}>{String((row as unknown[])[column] ?? "")}</td>)}</tr>)}</tbody></table></div><button type="button" className="secondary" disabled={busy} onClick={saveMapping}>Save mapping on this device</button> <button type="button" disabled={busy || preview.errors.length > 0 || preview.valid_count === 0} onClick={() => void importFile()}>{busy ? "Importing…" : `Import ${preview.valid_count} rows`}</button></section>}</>}
  </main>;
}
