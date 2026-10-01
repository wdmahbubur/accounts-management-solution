import { parseOrganizationId, type OrganizationId } from "@ams/contracts";

export const CURRENT_ORGANIZATION_COOKIE = "ams_current_organization";
export const COMPANY_CONTEXT_COOKIE = "ams_company_context";

const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,172}$/;

export interface CompanyContext {
  organizationId: OrganizationId;
  nonce: string;
}

export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export class StaleCompanyContextError extends Error {
  constructor() {
    super("Company context changed. Reload before submitting.");
    this.name = "StaleCompanyContextError";
  }
}

export function parseCompanyContext(
  organizationValue: unknown,
  nonceValue: unknown
): CompanyContext | null {
  try {
    if (typeof nonceValue !== "string" || !NONCE_PATTERN.test(nonceValue)) {
      return null;
    }

    return {
      organizationId: parseOrganizationId(organizationValue),
      nonce: nonceValue
    };
  } catch {
    return null;
  }
}

export function readCompanyContext(reader: CookieReader): CompanyContext | null {
  return parseCompanyContext(
    reader.get(CURRENT_ORGANIZATION_COOKIE)?.value,
    reader.get(COMPANY_CONTEXT_COOKIE)?.value
  );
}

export function assertFreshCompanySubmission(input: {
  expectedOrganizationId: unknown;
  expectedNonce: unknown;
  current: CompanyContext | null;
}): CompanyContext {
  const expected = parseCompanyContext(
    input.expectedOrganizationId,
    input.expectedNonce
  );

  if (
    !expected ||
    !input.current ||
    expected.organizationId !== input.current.organizationId ||
    expected.nonce !== input.current.nonce
  ) {
    throw new StaleCompanyContextError();
  }

  return input.current;
}

export function companyCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  };
}
