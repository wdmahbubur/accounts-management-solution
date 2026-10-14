import type {
  ApiFailure,
  PublicErrorCode,
  StableErrorCode
} from "@ams/contracts";
import { ContractValidationError } from "@ams/contracts";

const STATUS_BY_CODE: Readonly<Record<StableErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  STALE_VERSION: 409,
  PERIOD_LOCKED: 409,
  DOCUMENT_ALREADY_POSTED: 409,
  APPROVAL_REQUIRED: 409,
  APPROVAL_STALE: 409,
  JOURNAL_UNBALANCED: 422,
  ACCOUNT_NOT_POSTABLE: 422,
  CONTROL_ITEM_REQUIRED: 422,
  ALLOCATION_EXCEEDED: 409,
  PARTY_MISMATCH: 422,
  RECONCILIATION_LOCKED: 409,
  REVERSAL_EXISTS: 409,
  IDEMPOTENCY_CONFLICT: 409,
  DUPLICATE_IMPORT: 409,
  PLAN_READ_ONLY: 409,
  RATE_LIMITED: 429
};

const DEFAULT_MESSAGE: Readonly<Record<PublicErrorCode, string>> = {
  UNAUTHENTICATED: "Authentication is required.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NOT_FOUND: "The requested resource was not found.",
  VALIDATION_FAILED: "Request validation failed.",
  STALE_VERSION: "The resource changed. Refresh and retry with the latest version.",
  PERIOD_LOCKED: "The accounting date is in a locked period.",
  DOCUMENT_ALREADY_POSTED: "The document is already posted.",
  APPROVAL_REQUIRED: "Approval is required before this action.",
  APPROVAL_STALE: "The approval no longer matches the current document.",
  JOURNAL_UNBALANCED: "The journal is not balanced.",
  ACCOUNT_NOT_POSTABLE: "The selected account is not available for posting.",
  CONTROL_ITEM_REQUIRED: "A control account requires a matching subledger item.",
  ALLOCATION_EXCEEDED: "The allocation exceeds the available amount.",
  PARTY_MISMATCH: "The selected parties are not compatible.",
  RECONCILIATION_LOCKED: "The reconciliation is locked.",
  REVERSAL_EXISTS: "A reversal already exists.",
  IDEMPOTENCY_CONFLICT: "The idempotency key was already used with a different request.",
  DUPLICATE_IMPORT: "The same import has already been processed.",
  PLAN_READ_ONLY: "The current plan is read-only.",
  RATE_LIMITED: "Too many requests. Try again later.",
  INTERNAL_ERROR: "An unexpected error occurred."
};

export class CommandError extends Error {
  readonly code: PublicErrorCode;
  readonly status: number;
  readonly fields?: Readonly<Record<string, string>>;

  constructor(input: {
    code: PublicErrorCode;
    status?: number;
    message?: string;
    fields?: Readonly<Record<string, string>>;
  }) {
    super(input.message ?? DEFAULT_MESSAGE[input.code]);
    this.name = "CommandError";
    this.code = input.code;
    this.status =
      input.status ??
      (input.code === "INTERNAL_ERROR" ? 500 : STATUS_BY_CODE[input.code]);
    this.fields = input.fields;
  }

  static unauthenticated(): CommandError {
    return new CommandError({ code: "UNAUTHENTICATED" });
  }

  static forbidden(): CommandError {
    return new CommandError({ code: "FORBIDDEN" });
  }

  static notFound(): CommandError {
    return new CommandError({ code: "NOT_FOUND" });
  }

  static validation(
    fields: Readonly<Record<string, string>>,
    message?: string
  ): CommandError {
    return new CommandError({
      code: "VALIDATION_FAILED",
      status: 422,
      message,
      fields
    });
  }

  static conflict(
    code:
      | "STALE_VERSION"
      | "PERIOD_LOCKED"
      | "IDEMPOTENCY_CONFLICT"
      | "DOCUMENT_ALREADY_POSTED"
      | "APPROVAL_REQUIRED"
      | "APPROVAL_STALE"
      | "ALLOCATION_EXCEEDED"
      | "RECONCILIATION_LOCKED"
      | "REVERSAL_EXISTS"
      | "DUPLICATE_IMPORT"
      | "PLAN_READ_ONLY",
    fields?: Readonly<Record<string, string>>
  ): CommandError {
    return new CommandError({ code, fields });
  }

  static transient(): CommandError {
    return new CommandError({ code: "INTERNAL_ERROR", status: 503, message: "A temporary database conflict prevented completion. Retry with the same idempotency key." });
  }
}

export class RetryableTransactionError extends Error {
  constructor() { super("Retryable database transaction failure."); this.name="RetryableTransactionError"; }
}

export function retryableTransactionError(error:{code?:string;message?:string}):RetryableTransactionError|null {
  if(error.code==="40P01" || (error.code==="40001" && /could not serialize access|serialization failure/i.test(error.message??""))) return new RetryableTransactionError();
  return null;
}

export function normalizeCommandError(error: unknown): CommandError {
  if (error instanceof CommandError) {
    return error;
  }
  if (error instanceof ContractValidationError) {
    return CommandError.validation(error.fields, error.message);
  }
  return new CommandError({ code: "INTERNAL_ERROR" });
}

export function commandErrorBody(
  error: CommandError,
  requestId: string
): ApiFailure {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {})
    },
    meta: { request_id: requestId }
  };
}
