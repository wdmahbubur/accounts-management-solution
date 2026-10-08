import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { readCompanySetup } from "../../../../../../server/onboarding/setup.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = generateRequestId();
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const organizationId = parseOrganizationId((await context.params).organizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    return Response.json({ data: await readCompanySetup(runtime.client, actor), meta: { request_id: requestId } }, { headers });
  } catch (error) {
    const safe = normalizeCommandError(error);
    return Response.json(commandErrorBody(safe, requestId), { status: safe.status, headers });
  }
}
