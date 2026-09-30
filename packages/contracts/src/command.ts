export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type Uuid = Brand<string, "Uuid">;
export type OrganizationId = Brand<string, "OrganizationId">;
export type MoneyString = Brand<string, "MoneyString">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;
export type RequestId = Brand<string, "RequestId">;

export interface VersionedMutationInput {
  expected_version: number;
}

export interface MutationHeaders {
  idempotencyKey: IdempotencyKey | null;
  requestId: RequestId | null;
}

export interface CommandMeta {
  request_id: string;
  replayed: boolean;
}

export interface ApiSuccess<T> {
  data: T;
  meta: CommandMeta;
}

export const stableErrorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "STALE_VERSION",
  "PERIOD_LOCKED",
  "DOCUMENT_ALREADY_POSTED",
  "APPROVAL_REQUIRED",
  "APPROVAL_STALE",
  "JOURNAL_UNBALANCED",
  "ACCOUNT_NOT_POSTABLE",
  "CONTROL_ITEM_REQUIRED",
  "ALLOCATION_EXCEEDED",
  "PARTY_MISMATCH",
  "RECONCILIATION_LOCKED",
  "REVERSAL_EXISTS",
  "IDEMPOTENCY_CONFLICT",
  "DUPLICATE_IMPORT",
  "PLAN_READ_ONLY",
  "RATE_LIMITED"
] as const;

export type StableErrorCode = (typeof stableErrorCodes)[number];
export type PublicErrorCode = StableErrorCode | "INTERNAL_ERROR";

export interface ApiErrorBody {
  code: PublicErrorCode;
  message: string;
  fields?: Readonly<Record<string, string>>;
}

export interface ApiFailure {
  error: ApiErrorBody;
  meta: Pick<CommandMeta, "request_id">;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export class ContractValidationError extends Error {
  readonly fields: Readonly<Record<string, string>>;

  constructor(message: string, fields: Readonly<Record<string, string>>) {
    super(message);
    this.name = "ContractValidationError";
    this.fields = fields;
  }
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const MONEY_PATTERN = /^-?(?:0|[1-9]\d{0,17})\.\d{2}$/;
const IDEMPOTENCY_HEX_PATTERN = /^[0-9a-fA-F]{32,128}$/;
const IDEMPOTENCY_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{22,172}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function parseUuid(value: unknown, field = "id"): Uuid {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ContractValidationError("Request validation failed.", {
      [field]: "Expected a UUID string."
    });
  }
  return value as Uuid;
}

export function parseOrganizationId(value: unknown): OrganizationId {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ContractValidationError("Request validation failed.", {
      organization_id: "Expected a UUID string."
    });
  }
  return value as OrganizationId;
}

export function parseMoneyString(value: unknown, field = "amount"): MoneyString {
  if (typeof value !== "string" || !MONEY_PATTERN.test(value)) {
    throw new ContractValidationError("Request validation failed.", {
      [field]:
        "Expected a canonical two-decimal money string with at most 18 integer digits."
    });
  }
  return value as MoneyString;
}

export function parseExpectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ContractValidationError("Request validation failed.", {
      expected_version: "Expected a positive safe integer."
    });
  }
  return value as number;
}

export function parseIdempotencyKey(value: string | null): IdempotencyKey {
  if (
    value === null ||
    (!IDEMPOTENCY_HEX_PATTERN.test(value) &&
      !IDEMPOTENCY_BASE64URL_PATTERN.test(value))
  ) {
    throw new ContractValidationError("Request validation failed.", {
      idempotency_key:
        "Use a cryptographically random key with at least 128 encoded bits."
    });
  }
  return value as IdempotencyKey;
}

export function parseOptionalRequestId(value: string | null): RequestId | null {
  if (value === null || value === "") {
    return null;
  }
  if (!REQUEST_ID_PATTERN.test(value)) {
    throw new ContractValidationError("Request validation failed.", {
      request_id: "Use 1-128 URL/log-safe characters."
    });
  }
  return value as RequestId;
}

export function parseMutationHeaders(
  headers: Pick<Headers, "get">,
  options: { idempotency: "required" | "optional" }
): MutationHeaders {
  const rawIdempotency = headers.get("idempotency-key");
  const idempotencyKey =
    options.idempotency === "required"
      ? parseIdempotencyKey(rawIdempotency)
      : rawIdempotency
        ? parseIdempotencyKey(rawIdempotency)
        : null;

  return {
    idempotencyKey,
    requestId: parseOptionalRequestId(headers.get("x-request-id"))
  };
}

const UNTRUSTED_AUTHORITY_KEYS = new Set([
  "actor_id",
  "actorId",
  "actor_member_id",
  "actorMemberId",
  "created_by",
  "createdBy",
  "created_by_member_id",
  "createdByMemberId",
  "posted_by",
  "postedBy",
  "posted_by_member_id",
  "postedByMemberId",
  "organization_id",
  "organizationId",
  "role",
  "roles",
  "permission",
  "permissions",
  "capability",
  "capabilities",
  "user_metadata",
  "userMetadata"
]);

export function assertNoUntrustedAuthorityFields(value: unknown): void {
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (node === null || typeof node !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (UNTRUSTED_AUTHORITY_KEYS.has(key)) {
        throw new ContractValidationError("Request validation failed.", {
          [path ? `${path}.${key}` : key]:
            "Authority and organization context are derived server-side."
        });
      }
      visit(child, path ? `${path}.${key}` : key);
    }
  };

  visit(value, "");
}
