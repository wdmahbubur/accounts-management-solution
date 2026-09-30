import type { OrganizationCommandDefinition } from "./types";
import type { CommandExecutionDependencies } from "./types";
import { executeOrganizationCommand } from "./execute";

export function createOrganizationRouteHandler<Input, Output>(input: {
  definition: OrganizationCommandDefinition<Input, Output>;
  dependencies: CommandExecutionDependencies;
}) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ organizationId: string }> }
  ): Promise<Response> {
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

    return Response.json(result.body, { status: result.status });
  };
}
