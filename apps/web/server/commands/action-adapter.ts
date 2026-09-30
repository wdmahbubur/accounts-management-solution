import type {
  CommandExecutionDependencies,
  OrganizationCommandDefinition
} from "./types.ts";
import { executeOrganizationCommand } from "./execute.ts";

async function defaultHeadersProvider(): Promise<Headers> {
  const { headers } = await import("next/headers");
  return new Headers(await headers());
}

export function createOrganizationServerAction<Input, Output>(input: {
  definition: OrganizationCommandDefinition<Input, Output>;
  dependencies: CommandExecutionDependencies;
  headersProvider?: () => Promise<Headers>;
}) {
  return async function run(
    organizationId: string,
    rawInput: unknown
  ) {
    const result = await executeOrganizationCommand({
      definition: input.definition,
      organizationId,
      rawInput,
      headers: await (input.headersProvider ?? defaultHeadersProvider)(),
      dependencies: input.dependencies
    });

    return result.body;
  };
}
