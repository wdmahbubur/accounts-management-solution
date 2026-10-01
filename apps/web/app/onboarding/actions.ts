"use server";

import { redirect } from "next/navigation";

import { createClient } from "../../lib/supabase/server.ts";
import {
  CompanyOnboardingValidationError,
  parseCompanyOnboardingForm
} from "../../server/onboarding/input.ts";

function route(error: string): string {
  return `/onboarding/company?error=${encodeURIComponent(error)}`;
}

export async function createCompanyAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/onboarding/company");
  }

  let input;
  try {
    input = parseCompanyOnboardingForm(formData);
  } catch (error) {
    if (error instanceof CompanyOnboardingValidationError) {
      redirect(route(error.field));
    }
    redirect(route("invalid_input"));
  }

  const { data, error } = await supabase.rpc("create_company_atomic", {
    p_name: input.name,
    p_legal_name: input.legalName,
    p_country_code: input.countryCode,
    p_base_currency: input.baseCurrency,
    p_timezone: input.timezone,
    p_fiscal_year_start_month: input.fiscalYearStartMonth,
    p_books_start_date: input.booksStartDate,
    p_idempotency_key: input.idempotencyKey
  });

  if (error) {
    if (error.code === "23505") {
      redirect(route("retry_conflict"));
    }
    if (error.code === "22023") {
      redirect(route("invalid_input"));
    }
    redirect(route("setup_failed"));
  }

  const result = Array.isArray(data) ? data[0] : null;
  if (!result?.organization_id) {
    redirect(route("setup_failed"));
  }

  redirect(
    `/onboarding/company?status=created&organization=${encodeURIComponent(
      result.organization_id
    )}`
  );
}
