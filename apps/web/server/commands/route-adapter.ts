import type { OrganizationCommandDefinition } from "./types.ts";
import type { CommandExecutionDependencies } from "./types.ts";
import { executeOrganizationCommand } from "./execute.ts";
import { assertMutationOrigin } from "../auth/mutation-origin.ts";
import { commandErrorBody, normalizeCommandError } from "./errors.ts";
import { generateRequestId } from "./request-context.ts";

export function createOrganizationRouteHandler<Input, Output>(input: {
  definition: OrganizationCommandDefinition<Input, Output>;
  dependencies: CommandExecutionDependencies;
}) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ organizationId: string }> }
  ): Promise<Response> {
    const headers = { "Cache-Control": "private, no-store" };
    try {
      assertMutationOrigin(request.headers);
    } catch (error) {
      const safe = normalizeCommandError(error);
      return Response.json(commandErrorBody(safe, generateRequestId()), { status: safe.status, headers });
    }
    const { organizationId } = await context.params;

    let rawInput: unknown;
    try {
      rawInput = await request.json();
    } catch {
      rawInput = null;
    }

    const result = await executeOrganizationCommand({
      definition: input.definition,
      organizationId,
      rawInput,
      headers: request.headers,
      dependencies: input.dependencies
    });

    return Response.json(result.body, { status: result.status, headers });
  };
}
