import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { OrganizationId, RequestId } from "@ams/contracts";
import { parseMutationHeaders } from "@ams/contracts";

import type { CommandExecutionDependencies } from "./types.ts";

function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Non-finite numbers are not canonical JSON.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
      .join(",")}}`;
  }
  throw new TypeError("Unsupported request value.");
}

export function hashCanonicalRequest(input: {
  operation: string;
  organizationId: OrganizationId;
  payload: unknown;
}): string {
  return createHash("sha256")
    .update(
      canonicalize({
        operation: input.operation,
        organization_id: input.organizationId,
        payload: input.payload
      })
    )
    .digest("hex");
}

export function generateRequestId(): RequestId {
  return `req_${randomUUID()}` as RequestId;
}

export function generateIdempotencyKey(): string {
  return randomBytes(16).toString("base64url");
}

export const defaultRequestDependencies = {
  generateRequestId,
  hashRequest: hashCanonicalRequest
} satisfies Pick<
  CommandExecutionDependencies,
  "generateRequestId" | "hashRequest"
>;

export function buildRequestContext(input: {
  headers: Pick<Headers, "get">;
  idempotency: "required" | "optional";
  operation: string;
  organizationId: OrganizationId;
  payload: unknown;
  dependencies: Pick<
    CommandExecutionDependencies,
    "generateRequestId" | "hashRequest"
  >;
}) {
  const parsed = parseMutationHeaders(input.headers, {
    idempotency: input.idempotency
  });
  const requestId =
    parsed.requestId ?? input.dependencies.generateRequestId();

  return {
    requestId,
    idempotencyKey: parsed.idempotencyKey,
    requestHash: input.dependencies.hashRequest({
      operation: input.operation,
      organizationId: input.organizationId,
      payload: input.payload
    })
  };
}
