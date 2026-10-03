import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, CommandError, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; reconciliationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const params = await context.params; const organizationId = parseOrganizationId(params.organizationId); const reconciliationId = parseUuid(params.reconciliationId);
    const runtime = await roleRuntime(); const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("periods.reopen")) throw CommandError.forbidden();
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.trim().length > 1000) throw CommandError.validation({ reason: "Enter a reason between 10 and 1,000 characters." });
    const result = await runtime.client.rpc("reopen_reconciliation", { p_organization_id: organizationId, p_reconciliation_id: reconciliationId, p_reason: body.reason.trim(), p_request_id: requestId });
    if (result.error) {
      if (result.error.code === "42501" && /recent authentication/i.test(result.error.message ?? "")) throw new CommandError({ code: "FORBIDDEN", message: "Recent authentication is required. Reauthenticate in Settings → Security, then retry." });
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "P0002") throw CommandError.notFound();
      if (result.error.code === "23514" || result.error.code === "22023") throw CommandError.validation({ reason: "A finalized reconciliation and a valid reason are required." });
      throw new Error("Reconciliation could not be reopened.");
    }
    return Response.json({ data: { reopen_event_id: parseUuid(result.data) }, meta: { request_id: requestId } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
