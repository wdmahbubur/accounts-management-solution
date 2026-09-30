import type { ApiSuccess } from "@ams/contracts";
import {
  assertNoUntrustedAuthorityFields,
  parseOrganizationId
} from "@ams/contracts";
import { hasCapability } from "@ams/permissions";

import { resolveActorContext } from "../auth/index.ts";
import {
  commandErrorBody,
  CommandError,
  normalizeCommandError
} from "./errors.ts";
import { buildRequestContext } from "./request-context.ts";
import type {
  CommandExecutionDependencies,
  CommandExecutionResult,
  OrganizationCommandDefinition
} from "./types.ts";

export async function executeOrganizationCommand<Input, Output>(input: {
  definition: OrganizationCommandDefinition<Input, Output>;
  organizationId: unknown;
  rawInput: unknown;
  headers: Pick<Headers, "get">;
  dependencies: CommandExecutionDependencies;
}): Promise<CommandExecutionResult<Output>> {
  let requestId = input.dependencies.generateRequestId();

  try {
    const organizationId = parseOrganizationId(input.organizationId);
    const actor = await resolveActorContext(organizationId, input.dependencies);

    if (!hasCapability(actor.capabilities, input.definition.capability)) {
      throw CommandError.forbidden();
    }

    assertNoUntrustedAuthorityFields(input.rawInput);
    const validated = input.definition.validate(input.rawInput);

    const requestContext = buildRequestContext({
      headers: input.headers,
      idempotency: input.definition.idempotency,
      operation: input.definition.operation,
      organizationId,
      payload: validated,
      dependencies: input.dependencies
    });
    requestId = requestContext.requestId;

    const data = await input.definition.execute(
      {
        actor,
        ...requestContext
      },
      validated
    );

    const body: ApiSuccess<Output> = {
      data,
      meta: { request_id: requestId, replayed: false }
    };
    return { status: 200, body };
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return {
      status: normalized.status,
      body: commandErrorBody(normalized, requestId)
    };
  }
}
