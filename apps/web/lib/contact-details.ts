export type ContactDetail = { label: string; value: string };
export type ContactDetails = {
  displayName: string; legalName: string | null; email: string | null; phone: string | null;
  addressLines: string[]; taxIdentifiers: ContactDetail[];
};
export type ContactFieldDefinition = { name: string; label: string; keys: readonly string[]; autoComplete?: string };

export const addressFieldDefinitions: readonly ContactFieldDefinition[] = [
  { name: "line1", label: "Address line 1", keys: ["line1", "line_1", "address_line_1", "address1", "street"], autoComplete: "address-line1" },
  { name: "line2", label: "Address line 2", keys: ["line2", "line_2", "address_line_2", "address2"], autoComplete: "address-line2" },
  { name: "city", label: "City or town", keys: ["city", "town"], autoComplete: "address-level2" },
  { name: "region", label: "District, state or region", keys: ["region", "state", "division", "district"], autoComplete: "address-level1" },
  { name: "postal_code", label: "Postal code", keys: ["postal_code", "postcode", "zip"], autoComplete: "postal-code" },
  { name: "country", label: "Country", keys: ["country", "country_code"], autoComplete: "country-name" }
];
export const taxFieldDefinitions: readonly ContactFieldDefinition[] = [
  { name: "tin", label: "Tax identification number (TIN)", keys: ["tin", "TIN"] },
  { name: "bin", label: "Business identification number (BIN)", keys: ["bin", "BIN"] },
  { name: "vat_number", label: "VAT registration number", keys: ["vat_number", "vat", "VAT"] }
];

export function contactObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
export function detailLabel(key: string): string {
  if (["TIN", "BIN", "VAT"].includes(key.toUpperCase())) return key.toUpperCase();
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^\w/, first => first.toUpperCase());
}

/** Present legacy nested values without assuming a tax schema or mutating a snapshot. */
export function readableContactEntries(value: unknown, label = ""): ContactDetail[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return value.trim() ? [{ label, value: value.trim() }] : [];
  if (typeof value === "number" || typeof value === "boolean") return [{ label, value: String(value) }];
  if (Array.isArray(value)) return value.flatMap((item, index) => readableContactEntries(item, `${label}${label ? " · " : ""}${index + 1}`));
  if (typeof value === "object") return Object.entries(value).flatMap(([key, item]) => readableContactEntries(item, `${label}${label ? " · " : ""}${detailLabel(key)}`));
  return [];
}
function orderedEntries(value: unknown, definitions: readonly ContactFieldDefinition[], address: boolean): ContactDetail[] {
  const source = contactObject(value), consumed = new Set<string>(), result: ContactDetail[] = [];
  for (const definition of definitions) {
    // Multiple legacy aliases are independently retained and displayed, never collapsed.
    for (const key of definition.keys) {
      if (!Object.hasOwn(source, key)) continue;
      consumed.add(key);
      result.push(...readableContactEntries(source[key], address && typeof source[key] === "string" ? "" : definition.label));
    }
  }
  for (const [key, item] of Object.entries(source)) if (!consumed.has(key)) result.push(...readableContactEntries(item, detailLabel(key)));
  return result;
}

/** Accept a live contact OR an issued party_snapshot; callers choose the correct source. */
export function formatContactDetails(value: unknown): ContactDetails {
  const contact = contactObject(value);
  return {
    displayName: text(contact.display_name) ?? "Contact", legalName: text(contact.legal_name), email: text(contact.email), phone: text(contact.phone),
    addressLines: orderedEntries(contact.billing_address, addressFieldDefinitions, true).map(detail => detail.label ? `${detail.label}: ${detail.value}` : detail.value),
    taxIdentifiers: orderedEntries(contact.tax_identifiers, taxFieldDefinitions, false)
  };
}

/** Format valid exact monetary strings only. Invalid/absent amounts are not zero. */
export function formatContactMoney(value: unknown): string | null {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}
