import { createHash } from "node:crypto";

export const MAX_CONTACT_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_CONTACT_IMPORT_ROWS = 500;
type CsvResult = { rows: Array<{ row_no: number; input_data: Record<string, unknown>; errors: string[]; status: "valid" | "invalid" }>; sha256: string; bytes: Buffer };

function parseCsv(source: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') {
      if (cell.length) throw new Error("A quote can only start an empty CSV field.");
      quoted = true;
    } else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((value) => value.length) || rows.length) rows.push(row);
      row = [];
      if (rows.length > MAX_CONTACT_IMPORT_ROWS + 1) throw new Error("CSV has more than 500 data rows.");
    } else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (rows.length > MAX_CONTACT_IMPORT_ROWS + 1) throw new Error("CSV has more than 500 data rows.");
  return rows;
}
function bool(value: string | undefined): boolean | null {
  if (value === "true" || value === "yes" || value === "1") return true;
  if (value === "false" || value === "no" || value === "0") return false;
  return null;
}
export function parseContactCsv(source: string): CsvResult {
  const bytes = Buffer.from(source, "utf8");
  if (!bytes.length || bytes.length > MAX_CONTACT_IMPORT_BYTES) throw new Error("CSV must be between 1 byte and 5 MiB.");
  const parsed = parseCsv(source.replace(/^\uFEFF/, ""));
  const header = (parsed.shift() ?? []).map((value) => value.trim().toLowerCase());
  const allowed = ["display_name", "legal_name", "is_customer", "is_vendor", "email", "phone", "payment_terms_days", "credit_limit", "external_key", "is_active"];
  if (!header.length || header.some((name) => !name || !allowed.includes(name)) || new Set(header).size !== header.length ||
    !["display_name", "is_customer", "is_vendor"].every((name) => header.includes(name))) {
    throw new Error("CSV headers must be unique and include display_name, is_customer and is_vendor. Supported: " + allowed.join(", "));
  }
  if (!parsed.length || parsed.length > MAX_CONTACT_IMPORT_ROWS) throw new Error("CSV must contain 1-500 contact rows.");
  const rows = parsed.map((values, index) => {
    const errors: string[] = [];
    if (values.length !== header.length) errors.push("Column count does not match the header.");
    const data: Record<string, string> = {};
    header.forEach((key, column) => { data[key] = (values[column] ?? "").trim(); });
    const customer = bool(data.is_customer); const vendor = bool(data.is_vendor);
    if (!data.display_name?.trim() || data.display_name.length > 200) errors.push("display_name is required and limited to 200 characters.");
    if (customer === null || vendor === null || (!customer && !vendor)) errors.push("is_customer and is_vendor must be booleans and at least one must be true.");
    const terms = data.payment_terms_days ? Number(data.payment_terms_days) : 0;
    if (!Number.isSafeInteger(terms) || terms < 0 || terms > 3650) errors.push("payment_terms_days must be an integer from 0 to 3650.");
    const credit = data.credit_limit || null;
    if (credit !== null && !/^(0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(credit)) errors.push("credit_limit must be a nonnegative BDT amount with up to two decimals.");
    const email = data.email || null;
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.push("email is invalid.");
    for (const [field, limit] of [["legal_name", 200], ["phone", 40], ["external_key", 160]] as const) {
      if ((data[field]?.length ?? 0) > limit) errors.push(`${field} is limited to ${limit} characters.`);
    }
    if (data.is_active && bool(data.is_active) === null) errors.push("is_active must be a boolean when provided.");
    return { row_no: index + 2, input_data: { display_name: data.display_name, legal_name: data.legal_name || null,
      is_customer: customer, is_vendor: vendor, email, phone: data.phone || null, billing_address: {}, tax_identifiers: {},
      payment_terms_days: terms, credit_limit: credit, external_key: data.external_key || null,
      is_active: data.is_active ? bool(data.is_active) : true }, errors, status: errors.length ? "invalid" as const : "valid" as const };
  });
  return { rows, sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
}
