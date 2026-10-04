import { parseOrganizationId, parseUuid } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type Search = Record<string, string | string[] | undefined>;
type Evidence = {
  attachment_id: string; filename: string; content_type: string; byte_size: number;
  scan_status: "pending" | "clean" | "rejected"; uploaded_at: string; uploader: string;
  source_id: string; source_type: string; source_number: string | null; source_date: string;
};
const one = (value: string | string[] | undefined) => typeof value === "string" ? value : "";
const dateValid = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const formatDate = (value: string) => new Date(value).toLocaleDateString("en-BD", { timeZone: "Asia/Dhaka", dateStyle: "medium" });
const sizeLabel = (value: number) => value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;

export default async function EvidenceLibraryPage({ params, searchParams }: { params: Promise<{ organizationId: string }>; searchParams: Promise<Search> }) {
  let organizationId: ReturnType<typeof parseOrganizationId>;
  try { organizationId = parseOrganizationId((await params).organizationId); } catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  const query = await searchParams, search = one(query.search).trim(), from = one(query.from), to = one(query.to);
  const rawPage = one(query.page), pageNumber = rawPage ? Number(rawPage) : 1;
  let rows: Evidence[] = [], hasMore = false, forbidden = false, invalid = false;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("attachments.read")) throw CommandError.forbidden();
    if (search.length > 120 || !dateValid(from) || !dateValid(to) || (from && to && from > to)
      || !Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 100) throw CommandError.validation({ filters: "Enter valid evidence filters." });
    const result = await runtime.client.rpc("list_evidence_library", {
      p_organization_id: organizationId, p_search: search || null, p_from: from || null, p_to: to || null,
      p_offset: (pageNumber - 1) * 50, p_limit: 51
    });
    if (result.error) {
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "22023" || result.error.code === "22P02") throw CommandError.validation({ filters: "Enter valid evidence filters." });
      throw new Error("Evidence library could not be loaded.");
    }
    if (!Array.isArray(result.data) || result.data.length > 51) throw new Error("Invalid evidence response.");
    const parsed = result.data.map((value: unknown): Evidence => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid evidence row.");
      const row = value as Record<string, unknown>;
      parseUuid(row.attachment_id); parseUuid(row.source_id);
      if (typeof row.filename !== "string" || typeof row.content_type !== "string" || !Number.isSafeInteger(row.byte_size)
        || typeof row.scan_status !== "string" || !["pending", "clean", "rejected"].includes(row.scan_status)
        || typeof row.uploaded_at !== "string" || !Number.isFinite(Date.parse(row.uploaded_at))
        || typeof row.uploader !== "string" || typeof row.source_type !== "string"
        || (row.source_number !== null && typeof row.source_number !== "string") || typeof row.source_date !== "string") throw new Error("Invalid evidence row.");
      return row as unknown as Evidence;
    });
    hasMore = parsed.length > 50; rows = parsed.slice(0, 50);
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") forbidden = true;
    else if (error instanceof CommandError && error.code === "VALIDATION_FAILED") invalid = true;
    else if (!(error instanceof CommandError)) throw error;
  }
  if (forbidden) return <main><p className="eyebrow">Documents · Read only</p><h1>Access denied</h1><p>You need attachments.read to view supporting evidence.</p><Link href={`/o/${organizationId}`}>Back to company</Link></main>;
  const pageUrl = (page: number) => { const p = new URLSearchParams(); if (search) p.set("search", search); if (from) p.set("from", from); if (to) p.set("to", to); if (page > 1) p.set("page", String(page)); return `/o/${organizationId}/documents?${p}`; };
  return <main>
    <p className="eyebrow">Documents · Private evidence</p><h1>Evidence library</h1>
    <p>Find receipts and supporting files attached to documents you can access. Downloads are available only after the file is marked clean.</p>
    <form method="get" className="panel" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "1rem", alignItems: "end" }}>
      <label>Filename, source or uploader<input name="search" defaultValue={search} maxLength={120} /></label>
      <label>Uploaded from<input name="from" type="date" defaultValue={from} /></label>
      <label>Uploaded through<input name="to" type="date" defaultValue={to} /></label>
      <button type="submit">Search evidence</button>
    </form>
    {invalid && <p role="alert">Enter valid search dates and a search phrase up to 120 characters.</p>}
    <section aria-label="Evidence files" style={{ display: "grid", gap: "1rem", marginTop: "1.25rem" }}>
      {rows.length === 0 ? <div className="panel"><h2>No evidence found</h2><p>Clear a filter or attach a file to an eligible draft.</p></div> : rows.map((row) => <article className="panel" key={`${row.attachment_id}:${row.source_id}`}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "start", justifyContent: "space-between", gap: "1rem" }}>
          <div><h2 style={{ marginTop: 0 }}>{row.filename}</h2><p>{row.content_type} · {sizeLabel(row.byte_size)} · Uploaded {formatDate(row.uploaded_at)}</p></div>
          {row.scan_status === "clean" ? <Link className="button secondary" href={`/api/v1/organizations/${organizationId}/attachments/${row.attachment_id}/download`}>Download</Link>
            : <span className="eyebrow">{row.scan_status === "pending" ? "Pending security scan · Download unavailable" : "Rejected by security scan · Download unavailable"}</span>}
        </div>
        <p><strong>Source:</strong> <Link href={`/o/${organizationId}/accounting/documents/${row.source_id}`}>{row.source_number ?? row.source_type} · {row.source_type.replaceAll("_", " ")}</Link> · {formatDate(`${row.source_date}T12:00:00+06:00`)}</p>
        <p><strong>Uploaded by:</strong> {row.uploader}</p>
      </article>)}
    </section>
    <nav aria-label="Evidence pages" style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem" }}>
      {pageNumber > 1 ? <Link href={pageUrl(pageNumber - 1)}>Previous page</Link> : <span />}
      {hasMore && <Link href={pageUrl(pageNumber + 1)}>Next page</Link>}
    </nav>
  </main>;
}
