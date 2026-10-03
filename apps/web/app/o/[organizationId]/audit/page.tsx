import { parseOrganizationId, parseUuid } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type Search = Record<string, string | string[] | undefined>;
type AuditEvent = {
  id: string; created_at: string; actor_member_id: string | null; actor_kind: string;
  action: string; entity_type: string; entity_id: string | null; document_id: string | null;
  request_id: string; reason: string | null; change: unknown;
};
const one = (value: string | string[] | undefined) => typeof value === "string" ? value : "";
const dateStart = (value: string) => value ? `${value}T00:00:00+06:00` : null;
const dateEnd = (value: string) => value ? `${value}T23:59:59.999+06:00` : null;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function AuditPage({ params, searchParams }: { params: Promise<{ organizationId: string }>; searchParams: Promise<Search> }) {
  let organizationId: ReturnType<typeof parseOrganizationId>;
  try { organizationId = parseOrganizationId((await params).organizationId); } catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  const query = await searchParams;
  let events: AuditEvent[] = [], hasMore = false, nextCreatedAt = "", nextId = "", forbidden = false;
  const actorRaw = one(query.actor_member_id), entityIdRaw = one(query.entity_id), cursorAt = one(query.before_created_at), cursorId = one(query.before_id);
  const from = one(query.from), to = one(query.to), entityType = one(query.entity_type).trim(), action = one(query.action).trim();
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("audit.read")) throw CommandError.forbidden();
    const validDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!validDate(from) || !validDate(to) || entityType.length > 80 || action.length > 120 ||
      (actorRaw && !uuidPattern.test(actorRaw)) || (entityIdRaw && !uuidPattern.test(entityIdRaw)) || (cursorId && !uuidPattern.test(cursorId)))
      throw CommandError.validation({ filters: "Enter valid audit filters." });
    const actorId = actorRaw ? parseUuid(actorRaw, "actor_member_id") : null;
    const entityId = entityIdRaw ? parseUuid(entityIdRaw, "entity_id") : null;
    const beforeId = cursorId ? parseUuid(cursorId, "before_id") : null;
    const before = cursorAt && !Number.isNaN(Date.parse(cursorAt)) ? cursorAt : null;
    if (Boolean(before) !== Boolean(beforeId)) throw CommandError.validation({ cursor: "The page cursor is invalid." });
    const result = await runtime.client.rpc("search_audit_events", {
      p_organization_id: organizationId, p_actor_member_id: actorId, p_from: dateStart(from), p_to: dateEnd(to),
      p_entity_type: entityType || null, p_entity_id: entityId, p_action: action || null,
      p_before_created_at: before, p_before_id: beforeId, p_limit: 50
    });
    if (result.error) {
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "22023" || result.error.code === "22P02") throw CommandError.validation({ filters: "Enter valid audit filters." });
      throw new Error("Audit history could not be loaded.");
    }
    const data = result.data as { events?: AuditEvent[]; has_more?: boolean; next_created_at?: string | null; next_id?: string | null } | null;
    events = Array.isArray(data?.events) ? data.events : [];
    hasMore = Boolean(data?.has_more); nextCreatedAt = data?.next_created_at ?? ""; nextId = data?.next_id ?? "";
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") forbidden = true;
    else if (!(error instanceof CommandError)) throw error;
  }
  if (forbidden) return <main><p className="eyebrow">Company controls</p><h1>Access denied</h1><p>You need audit.read to view company history.</p><Link href={`/o/${organizationId}`}>Back to company</Link></main>;
  const nextUrl = new URLSearchParams();
  for (const [key, value] of Object.entries({ actor_member_id: actorRaw, from, to, entity_type: entityType, entity_id: entityIdRaw, action })) if (value) nextUrl.set(key, value);
  if (hasMore && nextCreatedAt && nextId) { nextUrl.set("before_created_at", nextCreatedAt); nextUrl.set("before_id", nextId); }
  return <main>
    <p className="eyebrow">Company controls · Read only</p><h1>Audit trail</h1>
    <p>Search append-only company activity. Change details are recursively redacted, and module events are limited to areas you can read.</p>
    <form method="get" className="panel" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "1rem", alignItems: "end" }}>
      <label>Actor member ID<input name="actor_member_id" defaultValue={actorRaw} inputMode="text" /></label>
      <label>From date (Dhaka)<input name="from" type="date" defaultValue={from} /></label>
      <label>To date (Dhaka)<input name="to" type="date" defaultValue={to} /></label>
      <label>Entity type<input name="entity_type" defaultValue={entityType} maxLength={80} /></label>
      <label>Entity or document ID<input name="entity_id" defaultValue={entityIdRaw} /></label>
      <label>Action contains<input name="action" defaultValue={action} maxLength={120} /></label>
      <button type="submit">Search history</button>
    </form>
    <section aria-label="Audit events" style={{ display: "grid", gap: "1rem", marginTop: "1.25rem" }}>
      {events.length === 0 ? <div className="panel"><h2>No matching events</h2><p>Try a wider date range or clear a filter.</p></div> : events.map((event) => <article className="panel" key={event.id}>
        <p className="eyebrow">{new Date(event.created_at).toLocaleString("en-BD", { timeZone: "Asia/Dhaka" })} · {event.actor_kind}{event.actor_member_id ? ` · ${event.actor_member_id}` : ""}</p>
        <h2>{event.action}</h2><p>{event.entity_type}{event.entity_id ? ` · ${event.entity_id}` : ""}</p>
        {event.document_id && <p><Link href={`/o/${organizationId}/accounting/documents/${event.document_id}`}>Open source document</Link></p>}
        {event.reason && <p>Reason: {event.reason}</p>}
        <details><summary>Redacted change details</summary><pre style={{ overflowX: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(event.change, null, 2)}</pre></details>
        <small>Request ID: {event.request_id}</small>
      </article>)}
    </section>
    {hasMore && <p style={{ marginTop: "1rem" }}><Link href={`/o/${organizationId}/audit?${nextUrl.toString()}`}>Load older events</Link></p>}
  </main>;
}
