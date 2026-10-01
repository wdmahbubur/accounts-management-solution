import { parseOrganizationId, parseUuid, type OrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
import { EvidenceUploadForm } from "./evidence-upload-form.tsx";
export const dynamic = "force-dynamic";
export const revalidate = 0;
type Search = Promise<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
export default async function EvidenceLibrary({ params, searchParams }: { params: Promise<{ organizationId: string }>; searchParams: Search }) {
  let organizationId: OrganizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); } catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  let actor;
  try { actor = await resolveActorContext(organizationId, runtime.dependencies); }
  catch (cause) { if (cause instanceof CommandError && cause.code === "NOT_FOUND") redirect("/companies?error=not_found"); throw cause; }
  if (!actor.capabilities.includes("attachments.read")) return <main><h1>Access denied</h1><p>You need evidence access to view this library.</p></main>;
  const paramsValue = await searchParams; const search = first(paramsValue.q).trim().slice(0, 100).toLocaleLowerCase();
  const uploadedOn = first(paramsValue.uploaded_on);
  const validUploadedOn = /^\d{4}-\d{2}-\d{2}$/.test(uploadedOn) ? uploadedOn : "";
  const [libraryResult, draftsResult] = await Promise.all([
    runtime.client.rpc("read_attachment_library", { p_organization_id: organizationId, p_limit: 100, p_after: null }),
    actor.capabilities.includes("attachments.write")
      ? runtime.client.rpc("read_uploadable_documents", { p_organization_id: organizationId })
      : Promise.resolve({ data: [], error: null })
  ]);
  if (libraryResult.error || !Array.isArray(libraryResult.data)) throw new Error("Evidence library is unavailable.");
  if (draftsResult.error || !Array.isArray(draftsResult.data)) throw new Error("Draft documents are unavailable.");
  const rows = libraryResult.data.filter((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    if (typeof row.original_filename !== "string" || typeof row.document_type !== "string") return false;
    const matchesSearch = !search || `${row.original_filename} ${row.document_type} ${String(row.document_number ?? "")} ${String(row.uploader_name ?? "")}`.toLocaleLowerCase().includes(search);
    const matchesDate = !validUploadedOn || (typeof row.uploaded_at === "string" && row.uploaded_at.slice(0, 10) === validUploadedOn);
    return matchesSearch && matchesDate;
  });
  const drafts = draftsResult.data.flatMap((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (typeof row.document_number !== "string" && typeof row.document_type !== "string") return [];
    try { return [{ id: parseUuid(row.document_id), label: `${row.document_number || row.document_type} · ${String(row.accounting_date ?? "")}` }]; }
    catch { return []; }
  });
  return <main className="management-shell"><p className="eyebrow">Private company evidence</p><h1>Documents and evidence</h1>
    <p>Files stay private, belong to a draft source document and cannot be downloaded while scanning is pending or rejected.</p>
    {actor.capabilities.includes("attachments.write") && <EvidenceUploadForm organizationId={organizationId} nonce={runtime.current.nonce} drafts={drafts} />}
    <section className="panel"><h2>Linked files</h2>
      <form method="get" role="search" className="settings-form"><label className="field"><span>Search filename, source or uploader</span><input name="q" type="search" maxLength={100} defaultValue={first(paramsValue.q)} /></label>
        <label className="field"><span>Uploaded on</span><input name="uploaded_on" type="date" defaultValue={validUploadedOn} /></label><button type="submit">Search</button></form>
      {rows.length === 0 ? <p>No matching linked evidence files.</p> : <div className="table-scroll"><table>
        <caption>Financial evidence for documents you are allowed to read.</caption><thead><tr><th scope="col">File</th><th scope="col">Source</th><th scope="col">Uploaded by</th><th scope="col">Uploaded</th><th scope="col">Type</th><th scope="col">Size</th><th scope="col">Scan status</th><th scope="col">Action</th></tr></thead>
        <tbody>{rows.map((value: unknown) => {
          const row = value as Record<string, unknown>; const id = parseUuid(row.attachment_id);
          const href = `/api/v1/organizations/${organizationId}/attachments/${id}/download`;
          return <tr key={id}><th scope="row">{String(row.original_filename)}</th><td>{String(row.document_number ?? row.document_type)}</td>
            <td>{String(row.uploader_name ?? "Member")}</td><td>{typeof row.uploaded_at === "string" ? row.uploaded_at.slice(0, 10) : ""}</td>
            <td>{String(row.content_type)}</td><td>{String(row.byte_size)} bytes</td><td>{String(row.scan_status)}</td>
            <td>{row.scan_status === "clean" ? <a href={href}>Download</a> : <span>Unavailable until clean</span>}</td></tr>;
        })}</tbody>
      </table></div>}
    </section>
  </main>;
}
