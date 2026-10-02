import { createHash } from "node:crypto";

export const MAX_CONTACT_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_CONTACT_IMPORT_ROWS = 500;
type CsvResult = { rows: Array<{ row_no: number; input_data: Record<string, unknown>; errors: string[]; status: "valid" | "invalid" }>; sha256: string; bytes: Buffer; mapping: Record<string, string> };

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
export const CONTACT_IMPORT_FIELDS = ["display_name", "legal_name", "is_customer", "is_vendor", "email", "phone", "payment_terms_days", "credit_limit", "external_key", "is_active"] as const;
export const ITEM_IMPORT_FIELDS = ["sku", "name", "unit", "default_unit_price", "sales_account_id", "purchase_account_id", "tax_code_id", "is_active"] as const;
export const FINANCIAL_DRAFT_IMPORT_FIELDS = ["party_id", "issue_date", "accounting_date", "due_date", "external_reference", "description",
  "line_description", "quantity", "unit_price", "discount_amount", "account_id", "cost_center_id", "tax_code_id", "tax_mode",
  "recognition_mode", "performance_confirmed", "supplier_invoice_date", "supplier_invoice_key", "terms", "notes"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function mappedColumns(header: string[], requestedMapping: unknown, fields: readonly string[], required: readonly string[]) {
  if (requestedMapping !== undefined && requestedMapping !== null && (typeof requestedMapping !== "object" || Array.isArray(requestedMapping))) {
    throw new Error("The column mapping must be an object.");
  }
  const requested = requestedMapping && typeof requestedMapping === "object" && !Array.isArray(requestedMapping) ? requestedMapping as Record<string, unknown> : {};
  if (Object.keys(requested).some((field) => !fields.includes(field))) throw new Error("The column mapping contains an unsupported field.");
  const mapping: Record<string, string> = {};
  for (const field of fields) {
    const value = requested[field] ?? header.find((name) => name.toLowerCase() === field) ?? null;
    if (value === null || value === "") continue;
    if (typeof value !== "string" || !header.includes(value)) throw new Error(`Choose a CSV column for ${field}.`);
    mapping[field] = value;
  }
  if (!required.every((field) => mapping[field])) throw new Error(`Map ${required.join(", ")} to CSV columns before validation.`);
  if (new Set(Object.values(mapping)).size !== Object.values(mapping).length) throw new Error("Each CSV column can map to only one field.");
  return mapping;
}
export function parseContactCsv(source: string, requestedMapping?: unknown): CsvResult {
  const bytes = Buffer.from(source, "utf8");
  if (!bytes.length || bytes.length > MAX_CONTACT_IMPORT_BYTES) throw new Error("CSV must be between 1 byte and 5 MiB.");
  if (source.includes("\0")) throw new Error("CSV cannot contain NUL characters.");
  const parsed = parseCsv(source.replace(/^\uFEFF/, ""));
  const header = (parsed.shift() ?? []).map((value) => value.trim());
  if (!header.length || header.some((name) => !name.trim() || name.length > 100) || new Set(header.map((name) => name.trim().toLowerCase())).size !== header.length) {
    throw new Error("CSV column headers must be nonempty, unique and at most 100 characters.");
  }
  const mapping = mappedColumns(header, requestedMapping, CONTACT_IMPORT_FIELDS, ["display_name", "is_customer", "is_vendor"]);
  if (!parsed.length || parsed.length > MAX_CONTACT_IMPORT_ROWS) throw new Error("CSV must contain 1-500 contact rows.");
  const rows = parsed.map((values, index) => {
    const errors: string[] = [];
    if (values.length !== header.length) errors.push("Column count does not match the header.");
    const data: Record<string, string> = {};
    for (const [field, sourceHeader] of Object.entries(mapping)) {
      const column = header.indexOf(sourceHeader); data[field] = (values[column] ?? "").trim();
    }
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
  if (Buffer.byteLength(JSON.stringify(rows), "utf8") > 4 * 1024 * 1024) throw new Error("Validated contact rows exceed the 4 MiB staging limit.");
  return { rows, sha256: createHash("sha256").update(bytes).digest("hex"), bytes, mapping };
}

export function parseItemCsv(source: string, requestedMapping?: unknown): CsvResult {
  const bytes = Buffer.from(source, "utf8");
  if (!bytes.length || bytes.length > MAX_CONTACT_IMPORT_BYTES) throw new Error("CSV must be between 1 byte and 5 MiB.");
  if (source.includes("\0")) throw new Error("CSV cannot contain NUL characters.");
  const parsed = parseCsv(source.replace(/^\uFEFF/, ""));
  const header = (parsed.shift() ?? []).map((value) => value.trim());
  if (!header.length || header.some((name) => !name || name.length > 100) || new Set(header.map((name) => name.toLowerCase())).size !== header.length) {
    throw new Error("CSV column headers must be nonempty, unique and at most 100 characters.");
  }
  const mapping = mappedColumns(header, requestedMapping, ITEM_IMPORT_FIELDS, ["name", "unit", "default_unit_price"]);
  if (!parsed.length || parsed.length > MAX_CONTACT_IMPORT_ROWS) throw new Error("CSV must contain 1-500 catalogue rows.");
  const rows = parsed.map((values, index) => {
    const errors: string[] = []; if (values.length !== header.length) errors.push("Column count does not match the header.");
    const data: Record<string, string> = {};
    for (const [field, sourceHeader] of Object.entries(mapping)) data[field] = (values[header.indexOf(sourceHeader)] ?? "").trim();
    if (!data.name?.trim() || data.name.length > 160) errors.push("name is required and limited to 160 characters.");
    if (!data.unit?.trim() || data.unit.length > 40) errors.push("unit is required and limited to 40 characters.");
    if (!data.default_unit_price || !/^(0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(data.default_unit_price)) errors.push("default_unit_price must be a nonnegative rate with up to six decimals.");
    if ((data.sku?.length ?? 0) > 80) errors.push("sku is limited to 80 characters.");
    for (const field of ["sales_account_id", "purchase_account_id", "tax_code_id"]) if (data[field] && !UUID.test(data[field])) errors.push(`${field} must be a UUID.`);
    if (!data.sales_account_id && !data.purchase_account_id) errors.push("Map a sales or purchase account default.");
    if (data.is_active && bool(data.is_active) === null) errors.push("is_active must be a boolean when provided.");
    return { row_no: index + 2, input_data: { sku: data.sku || null, name: data.name, unit: data.unit,
      default_unit_price: data.default_unit_price, sales_account_id: data.sales_account_id || null,
      purchase_account_id: data.purchase_account_id || null, tax_code_id: data.tax_code_id || null,
      is_active: data.is_active ? bool(data.is_active) : true }, errors, status: errors.length ? "invalid" as const : "valid" as const };
  });
  if (Buffer.byteLength(JSON.stringify(rows), "utf8") > 4 * 1024 * 1024) throw new Error("Validated item rows exceed the 4 MiB staging limit.");
  return { rows, sha256: createHash("sha256").update(bytes).digest("hex"), bytes, mapping };
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseFinancialDraftCsv(source: string, documentType: "invoice" | "bill", requestedMapping?: unknown): CsvResult {
  const bytes = Buffer.from(source, "utf8");
  if (!bytes.length || bytes.length > MAX_CONTACT_IMPORT_BYTES) throw new Error("CSV must be between 1 byte and 5 MiB.");
  if (source.includes("\0")) throw new Error("CSV cannot contain NUL characters.");
  const parsed = parseCsv(source.replace(/^\uFEFF/, "")); const header = (parsed.shift() ?? []).map((value) => value.trim());
  if (!header.length || header.some((name) => !name || name.length > 100) || new Set(header.map((name) => name.toLowerCase())).size !== header.length) {
    throw new Error("CSV column headers must be nonempty, unique and at most 100 characters.");
  }
  const required = ["party_id", "issue_date", "accounting_date", "description", "line_description", "quantity", "unit_price", "account_id", "tax_mode", "recognition_mode", "performance_confirmed"];
  const mapping = mappedColumns(header, requestedMapping, FINANCIAL_DRAFT_IMPORT_FIELDS, required);
  if (!parsed.length || parsed.length > MAX_CONTACT_IMPORT_ROWS) throw new Error("CSV must contain 1-500 draft documents.");
  const rows = parsed.map((values, index) => {
    const errors: string[] = []; if (values.length !== header.length) errors.push("Column count does not match the header.");
    const data: Record<string, string> = {};
    for (const [field, sourceHeader] of Object.entries(mapping)) data[field] = (values[header.indexOf(sourceHeader)] ?? "").trim();
    for (const field of ["party_id", "account_id"]) if (!UUID.test(data[field] ?? "")) errors.push(`${field} must be a company record UUID.`);
    for (const field of ["cost_center_id", "tax_code_id"]) if (data[field] && !UUID.test(data[field])) errors.push(`${field} must be a UUID when provided.`);
    for (const field of ["issue_date", "accounting_date"]) if (!validDate(data[field] ?? "")) errors.push(`${field} must be a valid YYYY-MM-DD date.`);
    for (const field of ["due_date", "supplier_invoice_date"]) if (data[field] && !validDate(data[field])) errors.push(`${field} must be a valid YYYY-MM-DD date.`);
    if (!data.description || data.description.length > 2000) errors.push("description is required and limited to 2000 characters.");
    if (!data.line_description || data.line_description.length > 500) errors.push("line_description is required and limited to 500 characters.");
    if (!/^(0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(data.quantity ?? "") || !data.quantity || /^0(?:\.0+)?$/.test(data.quantity)) errors.push("quantity must be greater than zero with up to six decimals.");
    if (!/^(0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(data.unit_price ?? "")) errors.push("unit_price must be a nonnegative rate with up to six decimals.");
    const discount = data.discount_amount || "0.00";
    if (!/^(0|[1-9]\d{0,15})\.\d{2}$/.test(discount)) errors.push("discount_amount must be a nonnegative BDT amount with two decimals.");
    if (data.tax_mode && !["inclusive", "exclusive"].includes(data.tax_mode)) errors.push("tax_mode must be inclusive or exclusive.");
    if (!(["earned_or_incurred", "deferred_revenue"].includes(data.recognition_mode)) || (documentType === "bill" && data.recognition_mode !== "earned_or_incurred")) {
      errors.push("recognition_mode is not supported for this document type.");
    }
    const confirmed = bool(data.performance_confirmed);
    if (confirmed === null) errors.push("performance_confirmed must be an explicit boolean.");
    if ((data.external_reference?.length ?? 0) > 160 || (data.supplier_invoice_key?.length ?? 0) > 160 || (data.terms?.length ?? 0) > 500 || (data.notes?.length ?? 0) > 2000) {
      errors.push("A reference, terms or notes field exceeds its limit.");
    }
    return { row_no: index + 2, input_data: { document_type: documentType, party_id: data.party_id, issue_date: data.issue_date,
      accounting_date: data.accounting_date, due_date: data.due_date || null, external_reference: data.external_reference || null,
      description: data.description, currency: "BDT", rounding_adjustment: "0.00", rounding_reason: null, rounding_account_id: null,
      trade: { original_document_id: null, recognition_mode: data.recognition_mode, performance_confirmed: confirmed,
        supplier_invoice_date: data.supplier_invoice_date || null, supplier_invoice_key: data.supplier_invoice_key || null,
        terms: data.terms || null, notes: data.notes || null }, movement: null, transfer: null,
      lines: [{ id: null, item_id: null, original_line_id: null, description: data.line_description, quantity: data.quantity,
        unit_price: data.unit_price, discount_amount: discount, account_id: data.account_id, cost_center_id: data.cost_center_id || null,
        tax_code_id: data.tax_code_id || null, tax_mode: data.tax_mode, cash_flow_class: null }],
      journal_rows: [], allocation_plan: [] }, errors, status: errors.length ? "invalid" as const : "valid" as const };
  });
  if (Buffer.byteLength(JSON.stringify(rows), "utf8") > 4 * 1024 * 1024) throw new Error("Validated financial draft rows exceed the 4 MiB staging limit.");
  return { rows, sha256: createHash("sha256").update(bytes).digest("hex"), bytes, mapping };
}
