import { parseOrganizationId, parseUuid, type Uuid } from "@ams/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext } from "../auth/types.ts";
import { CommandError } from "../commands/errors.ts";

type AuditClient = Pick<SupabaseClient, "from">;
type AuditCursor = { created_at: string; id: Uuid };
type AuditFilters = { actor?: string; action?: string; entity?: string; from?: string; to?: string; cursor?: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const forbiddenKey = /(password|secret|token|credential|authorization|cookie|file[_-]?content|other[_-]?organization|email|phone|address|tax[_-]?identifier|credit[_-]?limit)/i;

function dateValue(value: string | undefined, field: string) {
  if (!value) return undefined;
  if (!DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw CommandError.validation({ [field]: "Use a valid Bangladesh calendar date." });
  }
  return value;
}
function nextDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function cursorValue(raw?: string): AuditCursor | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof value.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.created_at) || Number.isNaN(Date.parse(value.created_at)) || typeof value.id !== "string" || !UUID.test(value.id)) throw new Error();
    return { created_at: value.created_at, id: parseUuid(value.id) };
  } catch { throw CommandError.validation({ cursor: "The audit page cursor is invalid." }); }
}
export const encodeAuditCursor = (cursor: AuditCursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, forbiddenKey.test(key) ? "[redacted]" : redact(child)]));
  return value;
}

export async function readAuditEvents(client: AuditClient, actor: ActorContext, filters: AuditFilters) {
  if (!actor.capabilities.includes("audit.read")) throw CommandError.forbidden();
  const organizationId = parseOrganizationId(actor.organizationId);
  const from = dateValue(filters.from, "from");
  const to = dateValue(filters.to, "to");
  if (from && to && from > to) throw CommandError.validation({ date_range: "The start date must be on or before the end date." });
  const actorId = filters.actor ? parseUuid(filters.actor, "actor") : undefined;
  const action = filters.action?.trim();
  const entity = filters.entity?.trim();
  if (action && action.length > 120) throw CommandError.validation({ action: "Action filters may contain at most 120 characters." });
  if (entity && entity.length > 80) throw CommandError.validation({ entity: "Entity filters may contain at most 80 characters." });

  const cursor = cursorValue(filters.cursor);
  let query = (client as any).from("audit_events")
    .select("id,actor_member_id,actor_kind,action,entity_type,entity_id,document_id,request_id,reason,redacted_change,created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(51);
  if (actorId) query = query.eq("actor_member_id", actorId);
  if (action) query = query.ilike("action", `%${action.replace(/[\\%_]/g, "\\$&")}%`);
  if (entity) query = query.ilike("entity_type", `%${entity.replace(/[\\%_]/g, "\\$&")}%`);
  // Organization dates use Asia/Dhaka, so the inclusive date range is translated to UTC explicitly.
  if (from) query = query.gte("created_at", `${from}T00:00:00+06:00`);
  if (to) query = query.lt("created_at", `${nextDay(to)}T00:00:00+06:00`);
  if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
  const { data, error } = await query;
  if (error) {
    if (error.code === "42501") throw CommandError.forbidden();
    throw new CommandError({ code: "INTERNAL_ERROR" });
  }
  if (!Array.isArray(data)) throw new CommandError({ code: "INTERNAL_ERROR" });
  const hasMore = data.length > 50;
  const rows = data.slice(0, 50).map((row: Record<string, unknown>) => ({
    id: parseUuid(row.id), actor_member_id: row.actor_member_id ? parseUuid(row.actor_member_id) : null,
    actor_kind: row.actor_kind, action: row.action, entity_type: row.entity_type,
    entity_id: row.entity_id ? parseUuid(row.entity_id) : null,
    document_id: row.document_id ? parseUuid(row.document_id) : null,
    request_id: row.request_id, reason: row.reason,
    redacted_change: redact(row.redacted_change), created_at: row.created_at
  }));
  const last = rows.at(-1);
  return { items: rows, hasMore, nextCursor: hasMore && last ? encodeAuditCursor({ created_at: String(last.created_at), id: last.id }) : null };
}

export function auditSourceHref(organizationId: string, row: { entity_type: unknown; entity_id: unknown; document_id: unknown }, capabilities: readonly string[]) {
  const root = `/o/${organizationId}`;
  if (typeof row.document_id === "string" && capabilities.includes("documents.read")) return `${root}/accounting/documents/${row.document_id}`;
  if (typeof row.entity_id !== "string") return null;
  const id = encodeURIComponent(row.entity_id);
  switch (row.entity_type) {
    case "business_document": return capabilities.includes("documents.read") ? `${root}/accounting/documents/${id}` : null;
    case "journal_entry": return capabilities.includes("ledger.read") ? `${root}/accounting/journals/${id}` : null;
    case "organization_member": case "member_role": return capabilities.includes("users.read") ? `${root}/settings/users` : null;
    case "attachment": return capabilities.includes("attachments.read") ? `${root}/documents` : null;
    default: return null;
  }
}
