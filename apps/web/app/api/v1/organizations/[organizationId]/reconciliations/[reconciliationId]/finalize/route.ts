import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, CommandError, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

export async function POST(_request: Request, context: { params: Promise<{ organizationId: string; reconciliationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const params = await context.params; const organizationId = parseOrganizationId(params.organizationId); const reconciliationId = parseUuid(params.reconciliationId);
    const runtime = await roleRuntime(); const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("periods.lock")) throw CommandError.forbidden();
    const result = await runtime.client.rpc("finalize_reconciliation", { p_organization_id: organizationId, p_reconciliation_id: reconciliationId, p_request_id: requestId });
    if (result.error) {
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "P0002") throw CommandError.notFound();
      if (result.error.code === "23P01" || result.error.code === "55000") throw CommandError.conflict("RECONCILIATION_LOCKED");
      if (result.error.code === "23514") throw CommandError.validation({ reconciliation: "Statement balances or the adjusted ledger closing do not reconcile. Resolve the unexplained difference before finalizing." });
      throw new Error("Reconciliation could not be finalized.");
    }
    return Response.json({ data: result.data, meta: { request_id: requestId } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
