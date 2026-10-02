"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ImportType = "contacts" | "items" | "invoice_drafts" | "bill_drafts";
type Row = { row_no: number; input_data: Record<string, unknown>; errors: string[]; status: string; contact_id?: string | null; result_id?: string | null };
type Job = { id: string; type: ImportType; status: string; filename: string; mapping: Record<string, string>; created_at: string; row_count: number; valid_count: number; invalid_count: number; rows: Row[] };
const fieldsByType = {
  contacts: ["display_name", "legal_name", "is_customer", "is_vendor", "email", "phone", "payment_terms_days", "credit_limit", "external_key", "is_active"],
  items: ["sku", "name", "unit", "default_unit_price", "sales_account_id", "purchase_account_id", "tax_code_id", "is_active"],
  invoice_drafts: ["party_id", "issue_date", "accounting_date", "due_date", "external_reference", "description", "line_description", "quantity", "unit_price", "discount_amount", "account_id", "cost_center_id", "tax_code_id", "tax_mode", "recognition_mode", "performance_confirmed", "terms", "notes"],
  bill_drafts: ["party_id", "issue_date", "accounting_date", "due_date", "external_reference", "description", "line_description", "quantity", "unit_price", "discount_amount", "account_id", "cost_center_id", "tax_code_id", "tax_mode", "recognition_mode", "performance_confirmed", "supplier_invoice_date", "supplier_invoice_key", "terms", "notes"]
};
const requiredByType: Record<ImportType, string[]> = {
  contacts: ["display_name", "is_customer", "is_vendor"], items: ["name", "unit", "default_unit_price"],
  invoice_drafts: ["party_id", "issue_date", "accounting_date", "description", "line_description", "quantity", "unit_price", "account_id", "tax_mode", "recognition_mode", "performance_confirmed"],
  bill_drafts: ["party_id", "issue_date", "accounting_date", "description", "line_description", "quantity", "unit_price", "account_id", "tax_mode", "recognition_mode", "performance_confirmed"]
};
const typeLabels: Record<ImportType, string> = { contacts: "Contacts", items: "Service items", invoice_drafts: "Invoice drafts", bill_drafts: "Bill drafts" };
function firstCsvRow(source: string) {
  source = source.replace(/^\uFEFF/, "");
  const cells: string[] = []; let value = ""; let quoted = false;
  for (let i = 0; i < source.length; i++) { const char = source[i]!;
    if (quoted) { if (char === '"' && source[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') quoted = false; else value += char; }
    else if (char === '"' && value.length === 0) quoted = true;
    else if (char === ",") { cells.push(value); value = ""; }
    else if (char === "\n" || char === "\r") break; else value += char;
  }
  cells.push(value); return cells.map((cell) => cell.trim());
}
export function ContactImportClient({ organizationId, nonce, jobs, canImportContacts, canImportItems, canImportInvoices, canImportBills }: { organizationId: string; nonce: string; jobs: Job[]; canImportContacts: boolean; canImportItems: boolean; canImportInvoices: boolean; canImportBills: boolean }) {
  const availableTypes = ( [canImportContacts && "contacts", canImportItems && "items", canImportInvoices && "invoice_drafts", canImportBills && "bill_drafts"].filter(Boolean) ) as ImportType[];
  const canRun = availableTypes.length > 0;
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]); const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importType, setImportType] = useState<ImportType>(availableTypes[0] ?? "contacts");
  async function selectFile(file: File | null) {
    if (!file) { setHeaders([]); setMapping({}); return; }
    const columns = firstCsvRow(await file.slice(0, 16384).text()); setHeaders(columns);
    setMapping(Object.fromEntries(fieldsByType[importType].flatMap((field) => {
      const header = columns.find((column) => column.toLowerCase() === field); return header ? [[field, header]] : [];
    })));
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setBusy(true);
    const form = new FormData(event.currentTarget); const file = form.get("file");
    try {
      if (!(file instanceof File) || !file.size) throw new Error("Choose a CSV file.");
      const response = await fetch(`/api/v1/organizations/${organizationId}/imports`, { method: "POST",
        headers: { "Content-Type": "application/json", "X-Company-Context": nonce },
        body: JSON.stringify({ type: importType, filename: file.name, csv: await file.text(), mapping }) });
      const result = await response.json(); if (!response.ok) throw new Error(result?.error?.message ?? "Import could not be staged.");
      setMessage(`Staged ${result.data.row_count} ${typeLabels[importType].toLowerCase()} rows. ${result.data.invalid_count} need correction before commit.`); event.currentTarget.reset(); setHeaders([]); setMapping({}); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import could not be staged."); }
    finally { setBusy(false); }
  }
  async function commit(job: Job) {
    setMessage(""); setBusy(true);
    try {
      for (let batch = 0; batch < 20; batch++) {
        const response = await fetch(`/api/v1/organizations/${organizationId}/imports/${job.id}/commit`, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Company-Context": nonce }, body: "{}" });
        const result = await response.json(); if (!response.ok) throw new Error(result?.error?.message ?? "Import could not be committed.");
        const failed = result.data.outcomes.filter((item: { status: string }) => item.status === "failed").length;
        if (failed) { setMessage(`${failed} row(s) could not be saved. Review the row errors and retry.`); router.refresh(); return; }
        setMessage(`Saved ${result.data.completed_count} of ${result.data.total_count} rows…`);
        if (!result.data.has_more) { setMessage(`All valid ${typeLabels[job.type].toLowerCase()} were saved${job.type.endsWith("_drafts") ? " as editable drafts" : ""}.`); router.refresh(); return; }
      }
      throw new Error("Import needs another request. Refresh the job and continue.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import could not be committed."); }
    finally { setBusy(false); }
  }
  return <>
    {canRun && <form className="panel toolbar" onSubmit={upload}><label>Import type<select value={importType} onChange={(event) => { const value = event.target.value as ImportType; setImportType(value); setMapping({}); }}>
      {availableTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></label>
      <label>{typeLabels[importType]} CSV<input name="file" type="file" accept=".csv,text/csv" required onChange={(event) => void selectFile(event.currentTarget.files?.[0] ?? null)} /></label>
      {headers.length > 0 && <fieldset className="import-mapping"><legend>Map CSV columns to {typeLabels[importType].toLowerCase()} fields</legend>{fieldsByType[importType].map((field) => <label key={field}>{field.replaceAll("_", " ")}{requiredByType[importType].includes(field) && " · required"}
        <select value={mapping[field] ?? ""} required={requiredByType[importType].includes(field)} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}>
          <option value="">Not mapped</option>{headers.map((header, index) => <option key={`${header}-${index}`} value={header}>{header || `Column ${index + 1}`}</option>)}
        </select></label>)}</fieldset>}
      <button disabled={busy} type="submit">{busy ? "Working…" : "Upload and validate"}</button>
      <p>{importType === "contacts" ? "Required fields: display_name, is_customer and is_vendor. At least one customer/vendor role is true." : importType === "items" ? "Required fields: name, unit and default_unit_price. Every item needs a sales or purchase account default." : "Required fields: party_id, issue_date, accounting_date, descriptions, quantity, unit_price, account_id, tax_mode, recognition_mode and performance_confirmed. UUIDs must belong to this company. This creates editable drafts only; it never posts ledger entries."} Map source headings before validation; up to 500 rows and 5 MiB.</p>
      {importType === "contacts" ? <a href="data:text/csv;charset=utf-8,display_name%2Cis_customer%2Cis_vendor%2Cemail%0AExample%20Customer%2Ctrue%2Cfalse%2Ccustomer%40example.com%0A" download="contacts-template.csv">Download CSV template</a> : importType === "items" ?
        <a href="data:text/csv;charset=utf-8,name%2Cunit%2Cdefault_unit_price%2Csales_account_id%0AConsulting%2Chour%2C1000.000000%2C" download="service-items-template.csv">Download CSV template</a> :
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(fieldsByType[importType].join(",") + "\n")}`} download={`${importType.replace("_", "-")}-template.csv`}>Download CSV template</a>}
    </form>}
    {message && <p role="status">{message}</p>}
    <section className="panel"><h2>Your imports</h2>
      {!jobs.length ? <p>No imports yet.</p> : jobs.map((job) => <article key={job.id} className="panel">
        <h3><Link href={`/o/${organizationId}/imports/${job.id}`}>{job.filename}</Link></h3><p>{typeLabels[job.type]} · {job.status} · {job.valid_count} valid · {job.invalid_count} invalid · {job.row_count} total{job.type.endsWith("_drafts") ? " · draft only" : ""}</p>
        <p>Column mapping: {Object.entries(job.mapping ?? {}).map(([field, column]) => `${column} → ${field}`).join(" · ") || "—"}</p>
        <p>Created {new Date(job.created_at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}</p>
        {job.rows.length > 0 && <div className="table-scroll"><table><thead><tr><th>CSV row</th><th>{job.type === "contacts" ? "Contact" : job.type === "items" ? "Item" : job.type === "invoice_drafts" ? "Customer" : "Vendor"}</th><th>{job.type === "contacts" ? "Customer / vendor" : job.type === "items" ? "Rate / unit" : "Date · line · amount"}</th><th>Issues</th><th>Status</th></tr></thead><tbody>
          {job.rows.map((row) => <tr key={row.row_no}><th>{row.row_no}</th><td>{String(row.input_data.display_name ?? row.input_data.name ?? row.input_data.party_id ?? "")}</td><td>{job.type === "contacts" ? `${row.input_data.is_customer ? "Customer" : ""}${row.input_data.is_customer && row.input_data.is_vendor ? " / " : ""}${row.input_data.is_vendor ? "Vendor" : ""}` : job.type === "items" ? `${String(row.input_data.default_unit_price ?? "")} / ${String(row.input_data.unit ?? "")}` : `${String(row.input_data.issue_date ?? "")} · ${String(row.input_data.lines && Array.isArray(row.input_data.lines) ? (row.input_data.lines[0] as Record<string, unknown>)?.description ?? "" : "")} · ${String(row.input_data.lines && Array.isArray(row.input_data.lines) ? (row.input_data.lines[0] as Record<string, unknown>)?.quantity ?? "" : "")} × ${String(row.input_data.lines && Array.isArray(row.input_data.lines) ? (row.input_data.lines[0] as Record<string, unknown>)?.unit_price ?? "" : "")}`}</td><td>{row.errors.join(" ") || "—"}</td><td>{row.status}</td></tr>)}
        </tbody></table></div>}
        {job.rows.some((row) => row.errors.length) && <a href={`/api/v1/organizations/${organizationId}/imports/${job.id}/errors`}>Download row error CSV</a>}
        {availableTypes.includes(job.type) && ["ready", "running"].includes(job.status) && job.invalid_count === 0 && <button disabled={busy} onClick={() => commit(job)}>Commit {job.valid_count} {typeLabels[job.type].toLowerCase()}</button>}
      </article>)}
    </section>
  </>;
}
