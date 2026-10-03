import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { assertMutationOrigin } from "../auth/mutation-origin.ts";
import { resolveActorContext } from "../auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../commands/errors.ts";
import { generateRequestId } from "../commands/request-context.ts";
import { roleRuntime } from "../roles/runtime.ts";

const noStore = { "Cache-Control": "private, no-store" };

export async function cancelQueuedTrialBalanceExport(request: Request, rawOrganizationId: string, rawExportId: string) {
  const fallbackRequestId = generateRequestId();
  try {
    assertMutationOrigin(request.headers);
    const organizationId = parseOrganizationId(rawOrganizationId);
    const exportId = parseUuid(rawExportId, "export_id");
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("reports.export") || !actor.capabilities.includes("exports.read")) {
      throw CommandError.forbidden();
    }
    const result = await runtime.client.rpc("cancel_trial_balance_export", {
      p_organization_id: organizationId,
      p_export_id: exportId,
      p_request_id: fallbackRequestId
    });
    if (result.error) {
      if (result.error.code === "28000") throw CommandError.unauthenticated();
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "P0002") throw CommandError.notFound();
      if (result.error.code === "40001") throw CommandError.conflict("STALE_VERSION");
      throw new Error("Export cancellation failed.");
    }
    const data = result.data;
    if (!data || typeof data !== "object" || Array.isArray(data) ||
      (data as Record<string, unknown>).id !== exportId ||
      (data as Record<string, unknown>).status !== "cancelled" ||
      typeof (data as Record<string, unknown>).replayed !== "boolean") throw new Error("Invalid export cancellation response.");
    return Response.json({ data, meta: { request_id: fallbackRequestId } }, { headers: noStore });
  } catch (error) {
    const safe = normalizeCommandError(error);
    return Response.json(commandErrorBody(safe, fallbackRequestId), { status: safe.status, headers: noStore });
  }
}
