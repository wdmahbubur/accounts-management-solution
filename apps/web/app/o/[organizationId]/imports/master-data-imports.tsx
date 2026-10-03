"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ImportType = "contacts" | "items";
type ImportSummary = { total?: number; valid?: number; invalid?: number; imported?: number };
type ImportRow = { row_no: number; status: string; preview?: { name?: string | null; detail?: string | null; unit?: string | null } | null; errors: { field?: string; message?: string; code?: string }[]; result_contact_id: string | null; result_item_id: string | null };
type ImportJob = { id: string; import_type: ImportType; source_name: string; status: string; row_count: number; result_summary: ImportSummary; created_at: string; rows?: ImportRow[] };
type ResponseBody = { data?: ImportJob | ImportJob[]; error?: { message?: string; fields?: Record<string, string> }; meta?: { processed?: number } };

const fieldGuide: Record<ImportType, string> = {
  contacts: "Required headers: display_name,is_customer,is_vendor. Optional: legal_name,email,phone,payment_terms_days,credit_limit,external_key,is_active. Boolean values are true or false.",
  items: "Required headers: name,unit,default_unit_price. Optional: sku,sales_account_id,purchase_account_id,tax_code_id,is_active. Use exact decimal rates; account and tax IDs must belong to this company."
};
const when = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(new Date(value));

export function MasterDataImports({ organizationId, capabilities }: { organizationId: string; capabilities: readonly string[] }) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [selected, setSelected] = useState<ImportJob | null>(null);
  const selectedId = useRef<string | null>(null);
  const canRun = capabilities.includes("imports.run");
  const canContacts = canRun && capabilities.includes("contacts.write");
  const canItems = canRun && capabilities.includes("catalog.write");
  const [type, setType] = useState<ImportType>(canContacts ? "contacts" : "items");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async (jobId?: string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/import-jobs`, { cache: "no-store" });
      const body = await response.json() as ResponseBody;
      if (!response.ok || !Array.isArray(body.data)) throw new Error(body.error?.message ?? "Import jobs could not be loaded.");
      const list = body.data as ImportJob[]; setJobs(list);
      const target = jobId ?? selectedId.current;
      if (target) {
        const detailResponse = await fetch(`/api/v1/organizations/${organizationId}/import-jobs/${target}`, { cache: "no-store" });
        const detail = await detailResponse.json() as ResponseBody;
        if (!detailResponse.ok || !detail.data || Array.isArray(detail.data)) throw new Error(detail.error?.message ?? "Import details could not be loaded.");
        selectedId.current = target; setSelected(detail.data as ImportJob);
      } else if (selectedId.current) setSelected(list.find(job => job.id === selectedId.current) ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Import jobs could not be loaded."); }
    finally { setLoading(false); }
  }, [organizationId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void refresh(); });
    return () => cancelAnimationFrame(frame);
  }, [refresh]);

  async function stage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!file || !canRun || (type === "contacts" ? !canContacts : !canItems)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const form = new FormData(); form.set("import_type", type); form.set("file", file);
      const response = await fetch(`/api/v1/organizations/${organizationId}/import-jobs`, { method: "POST",
        headers: { "X-Request-Id": `import-stage-${crypto.randomUUID()}`, "Idempotency-Key": crypto.randomUUID() }, body: form });
      const body = await response.json() as ResponseBody;
      if (!response.ok || !body.data || Array.isArray(body.data)) throw new Error(body.error?.fields?.file ?? body.error?.fields?.columns ?? body.error?.message ?? "CSV could not be staged.");
      setFile(null); selectedId.current = (body.data as ImportJob).id; setSelected(body.data as ImportJob); setNotice("CSV staged privately. Validate the preview before importing any rows.");
      const picker = document.querySelector<HTMLInputElement>("#master-data-import-file"); if (picker) picker.value = "";
      await refresh((body.data as ImportJob).id);
    } catch (e) { setError(e instanceof Error ? e.message : "CSV could not be staged."); }
    finally { setBusy(false); }
  }

  async function action(kind: "validate" | "commit") {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/import-jobs/${selected.id}/${kind}`, {
        method: "POST", headers: { "X-Request-Id": `import-${kind}-${crypto.randomUUID()}` }
      });
      const body = await response.json() as ResponseBody;
      if (!response.ok) throw new Error(body.error?.fields?.import ?? body.error?.message ?? `Import ${kind} failed.`);
      setNotice(kind === "validate" ? "Validation complete. Review the row results before continuing." : `Batch saved. ${body.meta?.processed ?? 0} rows processed; refresh to see progress.`);
      await refresh(selected.id);
    } catch (e) { setError(e instanceof Error ? e.message : `Import ${kind} failed.`); await refresh(selected.id); }
    finally { setBusy(false); }
  }

  const availableType = (value: ImportType) => value === "contacts" ? canContacts : canItems;
  return <main className="content"><p className="eyebrow">Data tools · Master data</p><h1>Imports</h1>
    <p>Only contacts and service catalogue items are supported. Rows are previewed first and then saved through the same permission checked commands as manual entry. A file import never creates journals or posts money.</p>
    {(canContacts || canItems) && <form className="panel" onSubmit={stage}>
      <h2>Stage a CSV</h2><label>Import type<select value={type} onChange={event => setType(event.target.value as ImportType)}>
        {canContacts && <option value="contacts">Contacts</option>}{canItems && <option value="items">Service items</option>}
      </select></label>
      <p>{fieldGuide[type]}</p><label>CSV file<input id="master-data-import-file" type="file" accept=".csv,text/csv" required onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
      <p>UTF-8 CSV · maximum 2 MiB and 500 rows. Existing contacts and items are not updated by import.</p>
      <button type="submit" disabled={busy || !file || !availableType(type)}>{busy ? "Working…" : "Stage CSV"}</button>
    </form>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section className="panel"><div className="toolbar"><h2>Your import jobs</h2><button type="button" className="secondary" disabled={busy || loading} onClick={() => void refresh()}>Refresh</button></div>
      {loading ? <p role="status">Loading import jobs…</p> : jobs.length === 0 ? <p>No import jobs yet.</p> :
        <div className="table-scroll"><table><thead><tr><th>Type and file</th><th>Status</th><th>Rows</th><th>Created</th><th>Details</th></tr></thead><tbody>
          {jobs.map(job => <tr key={job.id}><td>{job.import_type === "contacts" ? "Contacts" : "Service items"}<br /><small>{job.source_name}</small></td><td>{job.status}</td>
            <td>{job.result_summary.imported ?? 0} imported · {job.result_summary.invalid ?? 0} with errors · {job.result_summary.valid ?? job.row_count} ready</td>
            <td>{when(job.created_at)}</td><td><button type="button" className="secondary" onClick={() => void refresh(job.id)}>Open details</button></td></tr>)}
        </tbody></table></div>}
    </section>
    {selected && <section className="panel"><h2>{selected.import_type === "contacts" ? "Contact" : "Service item"} import preview</h2>
      <p>{selected.source_name} · {selected.status} · {selected.row_count} rows</p>
      {selected.status === "validating" && canRun && <button type="button" disabled={busy} onClick={() => void action("validate")}>Validate rows</button>}
      {selected.status === "ready" && canRun && (selected.result_summary.valid ?? 0) > 0 && <button type="button" disabled={busy} onClick={() => void action("commit")}>{selected.result_summary.imported ? "Continue import" : "Import valid rows"} · up to 25</button>}
      {selected.status === "completed" && <p role="status">Import processing is complete. Rows with errors were skipped and can be corrected in a new CSV.</p>}
      {selected.rows && selected.rows.length > 0 && <div className="table-scroll"><table><thead><tr><th>CSV row</th><th>Preview</th><th>Result</th><th>Errors</th><th>Created record</th></tr></thead><tbody>
        {selected.rows.map(row => <tr key={row.row_no}><td>{row.row_no}</td><td>{row.preview?.name ?? "Preview unavailable"}<br /><small>{row.preview?.detail ?? row.preview?.unit ?? ""}</small></td><td>{row.status}</td><td>{row.errors.map((item, index) => <span key={index}>{item.field ? `${item.field}: ` : ""}{item.message ?? item.code}<br /></span>)}</td>
          <td>{row.result_contact_id ?? row.result_item_id ?? "—"}</td></tr>)}
      </tbody></table></div>}
    </section>}
  </main>;
}
