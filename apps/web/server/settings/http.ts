import { parseOrganizationId } from "@ams/contracts";
import { assertMutationOrigin } from "../auth/mutation-origin.ts";
import { resolveActorContext } from "../auth/resolve-actor.ts";
import { commandErrorBody, CommandError, normalizeCommandError } from "../commands/errors.ts";
import { executeOrganizationCommand } from "../commands/execute.ts";
import { generateRequestId } from "../commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../company-context.ts";
import { roleRuntime } from "../roles/runtime.ts";
import { companySettingsCommand, readCompanySettings } from "./service.ts";
const noStore = { "Cache-Control": "private, no-store" };
export function settingsFailure(error: unknown) {
  const safe = error instanceof StaleCompanyContextError ? new CommandError({ code: "STALE_VERSION", message: "Company context changed. Reload before submitting." }) : normalizeCommandError(error);
  return Response.json(commandErrorBody(safe, generateRequestId()), { status: safe.status, headers: noStore });
}
export async function settingsGet(organizationId: string) {
  try {
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(parseOrganizationId(organizationId), runtime.dependencies);
    return Response.json({ data: await readCompanySettings(runtime.client, actor), meta: { request_id: generateRequestId(), replayed: false } }, { headers: noStore });
  } catch (error) { return settingsFailure(error); }
}
export async function settingsPatch(request: Request, organizationId: string) {
  try {
    assertMutationOrigin(request.headers);
    const runtime = await roleRuntime();
    assertFreshCompanySubmission({ expectedOrganizationId: organizationId, expectedNonce: request.headers.get("x-company-context"), current: runtime.current });
    let raw: unknown;
    try { raw = await request.json(); } catch { throw CommandError.validation({ body: "Expected JSON." }); }
    const result = await executeOrganizationCommand({ definition: companySettingsCommand(runtime.client), organizationId,
      rawInput: raw, headers: request.headers, dependencies: runtime.dependencies });
    return Response.json(result.body, { status: result.status, headers: noStore });
  } catch (error) { return settingsFailure(error); }
}
