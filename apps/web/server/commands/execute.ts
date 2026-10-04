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
  normalizeCommandError,
  RetryableTransactionError
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

    let data!:Output;let executed=false;
    const maxAttempts=requestContext.idempotencyKey?3:1;
    for(let attempt=0;attempt<maxAttempts;attempt++){
      try{data=await input.definition.execute({actor,...requestContext},validated);executed=true;break;}
      catch(error){
        if(!(error instanceof RetryableTransactionError))throw error;
        if(attempt+1>=maxAttempts)throw CommandError.transient();
        await new Promise((resolve)=>setTimeout(resolve,25*(2**attempt)+Math.floor(Math.random()*20)));
      }
    }
    if(!executed)throw CommandError.transient();

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
