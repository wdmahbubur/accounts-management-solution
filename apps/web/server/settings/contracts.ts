import { parseExpectedVersion, parseOrganizationId, type OrganizationId } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";
import { record } from "../roles/contracts.ts";
export const settingTextLimits = { name: 160, legal_name: 240, country_code: 2, base_currency: 3,
  timezone: 64, books_start_date: 10, contact_email: 254, contact_phone: 32 } as const;
export const addressKeys = ["line1", "line2", "city", "postal_code"] as const;
export interface CompanyChanges {
  name?: string; legal_name?: string; country_code?: string; base_currency?: "BDT";
  timezone?: string; books_start_date?: string; fiscal_year_start_month?: number;
  contact_email?: string; contact_phone?: string;
  address?: Partial<Record<(typeof addressKeys)[number], string>>;
}
export interface SettingsInput { expectedVersion: number; changes: CompanyChanges; reason: string }
export interface SettingsReceipt { settingsVersion: number; message: string }
export interface CompanySettings {
  organizationId: OrganizationId; name: string; legalName: string; countryCode: string; baseCurrency: "BDT";
  timezone: string; booksStartDate: string; fiscalYearStartMonth: number;
  contactEmail: string; contactPhone: string; address: Record<(typeof addressKeys)[number], string>;
  settingsVersion: number; foundationLocked: boolean;
  calendar: { label: string; kind: "opening" | "regular"; startsOn: string; endsOn: string; status: "open" | "locked" }[];
}
function fail(field: string, message: string): never { throw CommandError.validation({ [field]: message }); }
function only(v: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(v).some(k => !keys.includes(k))) fail("settings", "Unexpected configuration field.");
}
function date(raw: unknown, field: string, books = false): string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fail(field, "Use a valid YYYY-MM-DD date.");
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ||
    (books && (raw < "1900-01-02" || raw > "9998-12-31"))) return fail(field, "Choose a valid date between 1900-01-02 and 9998-12-31.");
  return raw;
}
export function settingsInput(raw: unknown): SettingsInput {
  const body = record(raw); only(body, ["expected_version", "changes", "reason"]);
  const expectedVersion = parseExpectedVersion(body.expected_version);
  if (expectedVersion > 2147483647) fail("expected_version", "Settings version is out of range.");
  if (typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 500) fail("reason", "Provide a reason of 3–500 characters.");
  const source = record(body.changes); only(source, [...Object.keys(settingTextLimits), "fiscal_year_start_month", "address"]);
  const changes: Record<string, unknown> = {};
  for (const [field, limit] of Object.entries(settingTextLimits)) {
    if (!(field in source)) continue;
    const value = source[field];
    if (typeof value !== "string" || Array.from(value).length > limit || value.includes("\u0000")) fail(field, `Use text of at most ${limit} characters.`);
    changes[field] = value;
  }
  for (const field of ["name", "legal_name"] as const) if (field in changes) {
    const value = (changes[field] as string).trim(); if (!value) fail(field, "This name is required."); changes[field] = value;
  }
  if ("country_code" in changes && !/^[A-Z]{2}$/.test(changes.country_code as string)) fail("country_code", "Use a two-letter uppercase country code.");
  if ("base_currency" in changes && changes.base_currency !== "BDT") fail("base_currency", "This version supports BDT books only.");
  if ("timezone" in changes) {
    try { new Intl.DateTimeFormat("en", { timeZone: changes.timezone as string }); }
    catch { fail("timezone", "Choose a valid timezone, such as Asia/Dhaka."); }
  }
  if ("books_start_date" in changes) changes.books_start_date = date(changes.books_start_date, "books_start_date", true);
  if ("contact_email" in changes) {
    const email = changes.contact_email as string;
    if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("contact_email", "Use a valid email or leave it empty.");
    changes.contact_email = email.toLowerCase();
  }
  if ("contact_phone" in changes) {
    if (!/^[0-9+() .-]*$/.test(changes.contact_phone as string)) fail("contact_phone", "Use a phone number or leave it empty.");
    changes.contact_phone = (changes.contact_phone as string).trim();
  }
  if ("fiscal_year_start_month" in source) {
    const m = source.fiscal_year_start_month;
    if (!Number.isInteger(m) || Number(m) < 1 || Number(m) > 12) fail("fiscal_year_start_month", "Choose a month from 1 to 12.");
    changes.fiscal_year_start_month = m;
  }
  if ("address" in source) {
    const address = record(source.address); only(address, addressKeys);
    for (const [key, value] of Object.entries(address)) {
      if (typeof value !== "string" || Array.from(value).length > 240 || value.includes("\u0000")) fail(`address.${key}`, "Use text of at most 240 characters.");
    }
    changes.address = { ...address };
  }
  return { expectedVersion, changes: changes as CompanyChanges, reason: body.reason.trim() };
}
/** Explicit projection: never serialize arbitrary database metadata to the client. */
export function parseSettings(raw: unknown, organizationId: OrganizationId): CompanySettings {
  const row = record(raw);
  if (parseOrganizationId(row.organization_id) !== organizationId || typeof row.foundation_locked !== "boolean" || !Array.isArray(row.calendar)) throw new Error("Invalid company settings response.");
  const parsed = settingsInput({ expected_version: row.settings_version, reason: "Read settings", changes: {
    ...Object.fromEntries(Object.keys(settingTextLimits).map(k => [k, row[k]])),
    fiscal_year_start_month: row.fiscal_year_start_month,
    address: Object.fromEntries(addressKeys.map(k => [k, record(row.address)[k]]))
  } });
  const c = parsed.changes;
  const calendar = row.calendar.map(item => {
    const p = record(item);
    if (typeof p.label !== "string" || !["opening", "regular"].includes(String(p.kind)) || !["open", "locked"].includes(String(p.status))) throw new Error("Invalid company calendar.");
    const startsOn = date(p.starts_on, "starts_on"), endsOn = date(p.ends_on, "ends_on");
    if (startsOn > endsOn) throw new Error("Invalid calendar interval.");
    return { label: p.label, kind: p.kind as "opening" | "regular", startsOn, endsOn, status: p.status as "open" | "locked" };
  });
  return { organizationId, name: c.name!, legalName: c.legal_name!, countryCode: c.country_code!, baseCurrency: "BDT",
    timezone: c.timezone!, booksStartDate: c.books_start_date!, fiscalYearStartMonth: c.fiscal_year_start_month!,
    contactEmail: c.contact_email!, contactPhone: c.contact_phone!, address: c.address as CompanySettings["address"],
    settingsVersion: parsed.expectedVersion, foundationLocked: row.foundation_locked, calendar };
}
