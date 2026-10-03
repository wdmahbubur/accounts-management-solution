"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ExportJob = {
  id: string; export_type: string; parameters: Record<string, string>; ledger_cutoff_at: string;
  format: string; status: "queued" | "running" | "completed" | "failed" | "expired" | "cancelled";
  expires_at: string | null; error_code: string | null; created_at: string;
};
type Envelope = { data?: ExportJob[]; error?: { message?: string; fields?: Record<string, string> } };

const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka"
}).format(new Date(value)) + " BST" : "—";
const reportLabels: Record<string, string> = { trial_balance: "Trial balance", profit_and_loss: "Profit and Loss", balance_sheet: "Balance Sheet", customer_statement: "Customer statement", vendor_statement: "Vendor statement" };
function period(job: ExportJob) {
  const p = job.parameters;
  if (job.export_type === "balance_sheet") return `As of ${p.as_of ?? "date unavailable"}${p.comparison_as_of ? ` · Compare ${p.comparison_as_of}` : ""}`;
  const range = p.from && p.to ? `${p.from} – ${p.to}` : p.as_of ?? p.to ?? "Date unavailable";
  if (job.export_type === "profit_and_loss") return `${range}${p.comparison_from && p.comparison_to ? ` · Compare ${p.comparison_from} – ${p.comparison_to}` : ""}${p.cost_center ? ` · Cost center ${p.cost_center}` : ""}`;
  if (job.export_type === "customer_statement" || job.export_type === "vendor_statement") return `${range} · Party ${p.party_id ?? "unavailable"}`;
  return range;
}
const errorText: Record<string, string> = {
  EXPORT_EMPTY_REPORT: "No report rows were available for this cutoff. Choose another date.",
  EXPORT_INVALID_REPORT_DATA: "The report contained an invalid amount and could not be rendered.",
  EXPORT_STORAGE_FAILED: "Private storage did not accept the file. Retry by requesting a new export.",
  EXPORT_RENDER_FAILED: "The file could not be rendered. Request a new export or contact support.",
  EXPORT_RETRY_LIMIT: "Automatic retries ended. Request a new export.",
  REQUESTER_ACCESS_REVOKED: "Your export access changed before the file was ready.",
  EXPORT_OUTPUT_TOO_LARGE: "The file exceeds the 10 MiB private download limit.",
  EXPORT_FONT_UNAVAILABLE: "The report PDF font files are unavailable. Request CSV or XLSX instead."
};

export function ExportJobs({ organizationId, canRequest }: { organizationId: string; canRequest: boolean }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/exports`, { cache: "no-store" });
      const body = await response.json() as Envelope;
      if (!response.ok || !Array.isArray(body.data)) throw new Error(body.error?.message ?? "Export jobs could not be loaded.");
      setJobs(body.data);
    } catch (e) { setError(e instanceof Error ? e.message : "Export jobs could not be loaded."); }
    finally { setLoading(false); }
  }, [organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadInitialJobs() {
      try {
        const response = await fetch(`/api/v1/organizations/${organizationId}/exports`, { cache: "no-store", signal: controller.signal });
        const body = await response.json() as Envelope;
        if (!response.ok || !Array.isArray(body.data)) throw new Error(body.error?.message ?? "Export jobs could not be loaded.");
        setJobs(body.data);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Export jobs could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadInitialJobs();
    return () => controller.abort();
  }, [organizationId]);

  async function cancel(id: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/exports/${id}/cancel`, {
        method: "POST", headers: { "X-Request-Id": `export-cancel-${crypto.randomUUID()}` }
      });
      const body = await response.json() as Envelope;
      if (!response.ok) throw new Error(body.error?.message ?? "Export could not be cancelled. Refresh to see its current status.");
      setNotice("Queued export cancelled."); await refresh(); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Export could not be cancelled."); }
    finally { setBusy(false); }
  }

  return <main className="content">
    <p className="eyebrow">Reports · Private files</p><h1>Export jobs</h1>
    <p>Each export captures the requested date and ledger cutoff. Files are private, available to the requester for 24 hours, and permission is checked again when downloaded.</p>
    {canRequest && <p className="panel">Exports use the snapshot currently shown by each report. <Link className="secondary" href={`/o/${organizationId}/reports/trial-balance`}>Open Trial Balance to export</Link></p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section className="panel"><div className="toolbar"><h2>Your exports</h2><button type="button" className="secondary" onClick={() => void refresh()} disabled={loading || busy}>Refresh jobs</button></div>
      {loading ? <p role="status">Loading export jobs…</p> : jobs.length === 0 ? <p>No export jobs yet.</p> :
        <div className="table-scroll"><table><thead><tr><th>Report and cutoff</th><th>Status</th><th>Requested</th><th>File expires</th><th>Details</th><th>Actions</th></tr></thead><tbody>
          {jobs.map(job => <tr key={job.id}><td>{reportLabels[job.export_type] ?? "Report export"} · {period(job)}<br /><small>Ledger cutoff: {dateTime(job.ledger_cutoff_at)}</small></td>
            <td><span className={`status status-${job.status}`}>{job.status}</span></td><td>{dateTime(job.created_at)}</td><td>{dateTime(job.expires_at)}</td>
            <td>{job.error_code ? errorText[job.error_code] ?? "The export failed. Request a new export." : job.status === "running" ? "Rendering a fixed report snapshot…" : `${job.format.toUpperCase()} · BDT`}</td>
            <td>{job.status === "completed" ? <a className="secondary" href={`/api/v1/organizations/${organizationId}/exports/${job.id}/download`}>Download {job.format.toUpperCase()}</a> :
              job.status === "queued" && canRequest ? <button type="button" className="secondary" disabled={busy} onClick={() => void cancel(job.id)}>Cancel queued job</button> : "—"}</td>
          </tr>)}
        </tbody></table></div>}
    </section>
  </main>;
}
