"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Row = { row_no: number; input_data: Record<string, unknown>; errors: string[]; status: string; contact_id: string | null };
type Job = { id: string; status: string; filename: string; created_at: string; row_count: number; valid_count: number; invalid_count: number; rows: Row[] };
export function ContactImportClient({ organizationId, nonce, jobs, canRun }: { organizationId: string; nonce: string; jobs: Job[]; canRun: boolean }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setBusy(true);
    const form = new FormData(event.currentTarget); const file = form.get("file");
    try {
      if (!(file instanceof File) || !file.size) throw new Error("Choose a CSV file.");
      const response = await fetch(`/api/v1/organizations/${organizationId}/imports`, { method: "POST",
        headers: { "Content-Type": "application/json", "X-Company-Context": nonce },
        body: JSON.stringify({ filename: file.name, csv: await file.text() }) });
      const result = await response.json(); if (!response.ok) throw new Error(result?.error?.message ?? "Import could not be staged.");
      setMessage(`Staged ${result.data.row_count} contact rows. ${result.data.invalid_count} need correction before commit.`); event.currentTarget.reset(); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import could not be staged."); }
    finally { setBusy(false); }
  }
  async function commit(job: Job) {
    setMessage(""); setBusy(true);
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/imports/${job.id}/commit`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Company-Context": nonce }, body: "{}" });
      const result = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(result?.error?.message ?? "Import could not be committed.");
      const failed = result.data.outcomes.filter((item: { status: string }) => item.status === "failed").length;
      setMessage(failed ? `${failed} row(s) could not be saved. Correct the source data and retry the failed rows.` : "All valid contacts were created."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import could not be committed."); }
    finally { setBusy(false); }
  }
  return <>
    {canRun && <form className="panel toolbar" onSubmit={upload}><label>Contact CSV<input name="file" type="file" accept=".csv,text/csv" required /></label>
      <button disabled={busy} type="submit">{busy ? "Working…" : "Upload and validate"}</button>
      <p>Required columns: display_name, is_customer, is_vendor. Optional: legal_name, email, phone, payment_terms_days, credit_limit, external_key, is_active. Up to 500 rows and 5 MiB.</p>
      <a href="data:text/csv;charset=utf-8,display_name%2Cis_customer%2Cis_vendor%2Cemail%0AExample%20Customer%2Ctrue%2Cfalse%2Ccustomer%40example.com%0A" download="contacts-template.csv">Download CSV template</a>
    </form>}
    {message && <p role="status">{message}</p>}
    <section className="panel"><h2>Your contact imports</h2>
      {!jobs.length ? <p>No contact imports yet.</p> : jobs.map((job) => <article key={job.id} className="panel">
        <h3><Link href={`/o/${organizationId}/imports/${job.id}`}>{job.filename}</Link></h3><p>{job.status} · {job.valid_count} valid · {job.invalid_count} invalid · {job.row_count} total</p>
        <p>Created {new Date(job.created_at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}</p>
        {job.rows.length > 0 && <div className="table-scroll"><table><thead><tr><th>CSV row</th><th>Name</th><th>Customer</th><th>Vendor</th><th>Issues</th><th>Status</th></tr></thead><tbody>
          {job.rows.map((row) => <tr key={row.row_no}><th>{row.row_no}</th><td>{String(row.input_data.display_name ?? "")}</td><td>{row.input_data.is_customer ? "Yes" : "No"}</td><td>{row.input_data.is_vendor ? "Yes" : "No"}</td><td>{row.errors.join(" ") || "—"}</td><td>{row.status}</td></tr>)}
        </tbody></table></div>}
        {job.rows.some((row) => row.errors.length) && <a href={`/api/v1/organizations/${organizationId}/imports/${job.id}/errors`}>Download row error CSV</a>}
        {canRun && ["ready", "running"].includes(job.status) && job.invalid_count === 0 && <button disabled={busy} onClick={() => commit(job)}>Commit {job.valid_count} valid contact(s)</button>}
      </article>)}
    </section>
  </>;
}
