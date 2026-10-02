import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { normalizeCommandError, commandErrorBody } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { readAuditEvents } from "../../../../../../server/audit/service.ts";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const organizationId = parseOrganizationId((await context.params).organizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const params = new URL(request.url).searchParams;
    const data = await readAuditEvents(runtime.client, actor, {
      actor: params.get("actor") ?? undefined, action: params.get("action") ?? undefined,
      entity: params.get("entity") ?? undefined, from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined, cursor: params.get("cursor") ?? undefined
    });
    return Response.json({ data, meta: { request_id: requestId, replayed: false } }, { headers });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers });
  }
}
