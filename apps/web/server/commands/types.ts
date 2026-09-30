import type {
  ApiResult,
  IdempotencyKey,
  OrganizationId,
  RequestId
} from "@ams/contracts";
import type { Capability } from "@ams/permissions";

import type { ActorContext } from "../auth";

export interface CommandRequestContext {
  requestId: RequestId;
  idempotencyKey: IdempotencyKey | null;
  requestHash: string;
}

export interface OrganizationCommandContext extends CommandRequestContext {
  actor: ActorContext;
}

export interface OrganizationCommandDefinition<Input, Output> {
  operation: string;
  capability: Capability;
  idempotency: "required" | "optional";
  validate(raw: unknown): Input;
  execute(
    context: OrganizationCommandContext,
    input: Input
  ): Promise<Output>;
}

export interface CommandExecutionDependencies {
  identityVerifier: import("../auth/index.ts").IdentityVerifier;
  membershipResolver: import("../auth/index.ts").MembershipResolver;
  generateRequestId(): RequestId;
  hashRequest(input: {
    operation: string;
    organizationId: OrganizationId;
    payload: unknown;
  }): string;
}

export interface CommandExecutionResult<T> {
  status: number;
  body: ApiResult<T>;
}
