import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CompanyOnboardingValidationError,
  parseCompanyOnboardingForm
} from "../../apps/web/server/onboarding/input.ts";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const values = {
    name: "Example Company",
    legal_name: "Example Company Limited",
    country_code: "BD",
    base_currency: "BDT",
    timezone: "Asia/Dhaka",
    fiscal_year_start_month: "1",
    books_start_date: "2026-04-01",
    idempotency_key: "company_setup_key_0123456789",
    ...overrides
  };

  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}

test("US-007 onboarding input normalizes the supported V1 contract", () => {
  assert.deepEqual(parseCompanyOnboardingForm(form({ country_code: "bd" })), {
    name: "Example Company",
    legalName: "Example Company Limited",
    countryCode: "BD",
    baseCurrency: "BDT",
    timezone: "Asia/Dhaka",
    fiscalYearStartMonth: 1,
    booksStartDate: "2026-04-01",
    idempotencyKey: "company_setup_key_0123456789"
  });
});

test("US-007 onboarding rejects unsupported currency before RPC execution", () => {
  assert.throws(
    () => parseCompanyOnboardingForm(form({ base_currency: "USD" })),
    (error: unknown) =>
      error instanceof CompanyOnboardingValidationError &&
      error.field === "base_currency"
  );
});

test("US-007 onboarding requires a retry-stable strong idempotency key", () => {
  assert.throws(
    () => parseCompanyOnboardingForm(form({ idempotency_key: "short" })),
    (error: unknown) =>
      error instanceof CompanyOnboardingValidationError &&
      error.field === "idempotency_key"
  );
});

test("US-007 database follow-up uses the current normalized identity email column", () => {
  const migration = readFileSync(new URL(
    "../../database/migrations/0082_fix_company_onboarding_identity_email.sql",
    import.meta.url
  ), "utf8");
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_company_atomic/);
  assert.match(migration, /split_part\(u\.email_normalized,/);
  assert.doesNotMatch(migration, /split_part\(u\.email,/);
});
