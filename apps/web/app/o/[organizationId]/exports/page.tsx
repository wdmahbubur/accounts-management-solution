import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
import { readExportJobs } from "../../../../server/reports/exports.ts";
import { ExportRequestForm } from "./export-request-form.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function ExportsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  let organizationId: string;
  try { organizationId = parseOrganizationId((await params).organizationId); } catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const jobs = await readExportJobs(runtime.client, actor);
    const canRequest = ["reports.read", "reports.export", "accounting.read", "ledger.read", "exports.read"].every((capability) => actor.capabilities.includes(capability));
    return <main className="content"><p className="eyebrow">Reports</p><h1>Export jobs</h1>
      <p>Export files are private, tied to a report cutoff, and available for 24 hours after completion. Downloads recheck current access.</p>
      {canRequest && <ExportRequestForm organizationId={organizationId} nonce={runtime.current.nonce} />}
      <section className="panel"><h2>Your export requests</h2>
        {jobs.length === 0 ? <p>No report exports requested.</p> : <div className="table-scroll"><table>
          <thead><tr><th>Report</th><th>Period and cutoff</th><th>Format</th><th>Status</th><th>Requested</th><th>Expires</th><th>Output</th></tr></thead>
          <tbody>{jobs.map((job) => {
            const parameters = job.parameters && typeof job.parameters === "object" ? job.parameters as Record<string, unknown> : {};
            const complete = job.status === "completed" && typeof job.expires_at === "string" && Date.parse(job.expires_at) > Date.now();
            return <tr key={job.id}><th scope="row">{String(job.export_type).replaceAll("_", " ")}</th>
              <td>{String(parameters.from ?? "All opening activity")} to {String(parameters.as_of ?? "—")}<small>Cutoff {String(job.ledger_cutoff_at)}</small></td>
              <td>{String(job.format).toUpperCase()}</td><td>{String(job.status)}{job.error_code ? ` · ${String(job.error_code)}` : ""}</td>
              <td>{new Date(String(job.created_at)).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}</td>
              <td>{job.expires_at ? new Date(String(job.expires_at)).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" }) : "—"}</td>
              <td>{complete ? <Link href={`/api/v1/organizations/${organizationId}/exports/${job.id}/download`}>Download · {String(job.result_size)} bytes</Link> : "—"}</td>
            </tr>;
          })}</tbody>
        </table></div>}
      </section>
    </main>;
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "FORBIDDEN") return <main className="content"><h1>Access denied</h1><p>You need exports.read to view export jobs.</p></main>;
    throw error;
  }
}
