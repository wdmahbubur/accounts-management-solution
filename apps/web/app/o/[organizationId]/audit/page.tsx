import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
import { auditSourceHref, readAuditEvents } from "../../../../server/audit/service.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AuditPage({ params, searchParams }: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ actor?: string; action?: string; entity?: string; from?: string; to?: string; cursor?: string }>;
}) {
  let organizationId: string;
  try { organizationId = parseOrganizationId((await params).organizationId); } catch { redirect("/companies?error=not_found"); }
  const filters = await searchParams;
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const result = await readAuditEvents(runtime.client, actor, filters);
    const next = new URLSearchParams();
    for (const key of ["actor", "action", "entity", "from", "to"] as const) if (filters[key]) next.set(key, filters[key]!);
    if (result.nextCursor) next.set("cursor", result.nextCursor);
    return <main className="content">
      <p className="eyebrow">Company history</p><h1>Audit trail</h1>
      <p>Append-only activity for this company. Results are newest first and each page has a stable event-time and ID cursor.</p>
      <form className="panel toolbar" action={`/o/${organizationId}/audit`} method="get">
        <label>Actor member ID<input name="actor" inputMode="text" autoComplete="off" placeholder="Optional member UUID" defaultValue={filters.actor ?? ""} /></label>
        <label>From date<input type="date" name="from" defaultValue={filters.from ?? ""} /></label>
        <label>Through date<input type="date" name="to" defaultValue={filters.to ?? ""} /></label>
        <label>Entity type<input name="entity" maxLength={80} defaultValue={filters.entity ?? ""} /></label>
        <label>Action contains<input name="action" maxLength={120} defaultValue={filters.action ?? ""} /></label>
        <button type="submit">Search history</button>
      </form>
      <section className="panel" aria-label="Audit events">
        <h2>Events</h2>
        {result.items.length === 0 ? <p>No audit events match these filters.</p> : <div className="table-scroll"><table>
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Source / entity</th><th>Request ID</th><th>Reason and change</th></tr></thead>
          <tbody>{result.items.map((event) => {
            const source = auditSourceHref(organizationId, event, actor.capabilities);
            return <tr key={event.id}>
              <td><time dateTime={String(event.created_at)}>{new Date(String(event.created_at)).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}</time></td>
              <td>{event.actor_kind === "user" ? `Member ${event.actor_member_id ?? "unknown"}` : `${String(event.actor_kind)} actor`}</td>
              <td>{String(event.action)}</td>
              <td>{source ? <Link href={source}>{String(event.entity_type)} · {String(event.entity_id ?? event.document_id)}</Link> : <>{String(event.entity_type)} · {String(event.entity_id ?? event.document_id ?? "—")}</>}</td>
              <td><code>{String(event.request_id)}</code></td>
              <td>{event.reason ? <p>{String(event.reason)}</p> : null}<details><summary>View redacted change</summary><pre>{JSON.stringify(event.redacted_change, null, 2)}</pre></details></td>
            </tr>;
          })}</tbody>
        </table></div>}
        {result.nextCursor && <p><Link className="secondary" href={`/o/${organizationId}/audit?${next.toString()}`}>Next 50 events</Link></p>}
      </section>
      <p>Audit history is read-only. Source links are shown only when the current membership can read that module.</p>
    </main>;
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "FORBIDDEN") return <main className="content"><h1>Access denied</h1><p>You need audit.read to view this company’s history.</p></main>;
    if (error instanceof CommandError && error.code === "VALIDATION_ERROR") return <main className="content"><h1>Invalid filters</h1><p>Check the member ID, date range and page cursor, then search again.</p></main>;
    throw error;
  }
}
