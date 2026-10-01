import { parseOrganizationId } from "@ams/contracts";
import { assertMutationOrigin } from "../auth/mutation-origin.ts";
import { resolveActorContext } from "../auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../commands/errors.ts";
import { executeOrganizationCommand } from "../commands/execute.ts";
import { generateRequestId } from "../commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../company-context.ts";
import type { RoleOperation } from "./contracts.ts";
import { record } from "./contracts.ts";
import { roleRuntime } from "./runtime.ts";
import { readRoleManagement, roleCommand } from "./service.ts";

const noStore = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const safe = error instanceof StaleCompanyContextError
    ? new CommandError({ code: "STALE_VERSION", message: "Company context changed. Reload before submitting." })
    : normalizeCommandError(error);
  return Response.json(commandErrorBody(safe, generateRequestId()), { status: safe.status, headers: noStore });
}
export async function roleGet(organizationId: string, resource: "roles" | "members") {
  try {
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(parseOrganizationId(organizationId), runtime.dependencies);
    const data = await readRoleManagement(runtime.client, actor);
    return Response.json({ data: data[resource], meta: { request_id: generateRequestId(), replayed: false } }, { headers: noStore });
  } catch (error) { return failure(error); }
}
export async function roleMutation(request: Request, organizationId: string,
  operation: RoleOperation, target?: { role_id: string } | { member_id: string }) {
  try {
    assertMutationOrigin(request.headers);
    const runtime = await roleRuntime();
    assertFreshCompanySubmission({ expectedOrganizationId: organizationId,
      expectedNonce: request.headers.get("x-company-context"), current: runtime.current });
    let raw: unknown;
    try { raw = await request.json(); } catch { throw CommandError.validation({ body: "Expected JSON." }); }
    const body = record(raw);
    // Targets are URL-scoped. A conflicting body target is rejected instead of silently rewritten.
    if (target && Object.keys(target).some((key) => key in body)) throw CommandError.validation({ body: "Supply the target in the URL only." });
    const result = await executeOrganizationCommand({ definition: roleCommand(operation, runtime.client),
      organizationId, rawInput: { ...body, ...target }, headers: request.headers, dependencies: runtime.dependencies });
    return Response.json(result.body, { status: result.status, headers: noStore });
  } catch (error) { return failure(error); }
}
