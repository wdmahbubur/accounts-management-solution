export interface CompanyOnboardingInput {
  name: string;
  legalName: string;
  countryCode: string;
  baseCurrency: "BDT";
  timezone: string;
  fiscalYearStartMonth: number;
  booksStartDate: string;
  idempotencyKey: string;
}

export class CompanyOnboardingValidationError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = "CompanyOnboardingValidationError";
  }
}

function value(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

export function parseCompanyOnboardingForm(
  formData: FormData
): CompanyOnboardingInput {
  const name = value(formData, "name");
  const legalName = value(formData, "legal_name");
  const countryCode = value(formData, "country_code").toUpperCase();
  const baseCurrency = value(formData, "base_currency").toUpperCase();
  const timezone = value(formData, "timezone");
  const fiscalMonth = Number(value(formData, "fiscal_year_start_month"));
  const booksStartDate = value(formData, "books_start_date");
  const idempotencyKey = value(formData, "idempotency_key");

  if (!name || name.length > 160) {
    throw new CompanyOnboardingValidationError("name", "Enter a company name.");
  }
  if (!legalName || legalName.length > 240) {
    throw new CompanyOnboardingValidationError(
      "legal_name",
      "Enter the legal company name."
    );
  }
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new CompanyOnboardingValidationError(
      "country_code",
      "Use a two-letter country code."
    );
  }
  if (baseCurrency !== "BDT") {
    throw new CompanyOnboardingValidationError(
      "base_currency",
      "V1 supports BDT only."
    );
  }
  if (!timezone || timezone.length > 64) {
    throw new CompanyOnboardingValidationError(
      "timezone",
      "Choose a valid timezone."
    );
  }
  if (!Number.isInteger(fiscalMonth) || fiscalMonth < 1 || fiscalMonth > 12) {
    throw new CompanyOnboardingValidationError(
      "fiscal_year_start_month",
      "Choose a fiscal-year start month."
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booksStartDate)) {
    throw new CompanyOnboardingValidationError(
      "books_start_date",
      "Choose a books-start date."
    );
  }
  if (!/^[A-Za-z0-9_-]{22,172}$/.test(idempotencyKey)) {
    throw new CompanyOnboardingValidationError(
      "idempotency_key",
      "Refresh the form and try again."
    );
  }

  return {
    name,
    legalName,
    countryCode,
    baseCurrency: "BDT",
    timezone,
    fiscalYearStartMonth: fiscalMonth,
    booksStartDate,
    idempotencyKey
  };
}
