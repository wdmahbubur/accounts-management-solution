import { headers as nextHeaders } from "next/headers";

import type { CommandExecutionDependencies, OrganizationCommandDefinition } from "./types.ts";
import { executeOrganizationCommand } from "./execute.ts";

export function createOrganizationServerAction<Input, Output>(input: {
  definition: OrganizationCommandDefinition<Input, Output>;
  dependencies: CommandExecutionDependencies;
  headersProvider?: () => Promise<Headers>;
}) {
  return async function run(
    organizationId: string,
    rawInput: unknown
  ) {
    const headersProvider =
      input.headersProvider ?? (async () => new Headers(await nextHeaders()));

    const result = await executeOrganizationCommand({
      definition: input.definition,
      organizationId,
      rawInput,
      headers: await headersProvider(),
      dependencies: input.dependencies
    });

    return result.body;
  };
}
