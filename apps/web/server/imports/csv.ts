import { CommandError } from "../commands/errors.ts";

export type ImportType = "contacts" | "items";
export type StagedCsvRow = { row_no: number; input_data: Record<string, unknown> };

const columns: Record<ImportType, { allowed: string[]; required: string[] }> = {
  contacts: {
    allowed: ["display_name", "legal_name", "is_customer", "is_vendor", "email", "phone", "payment_terms_days", "credit_limit", "external_key", "is_active"],
    required: ["display_name", "is_customer", "is_vendor"]
  },
  items: {
    allowed: ["sku", "name", "unit", "default_unit_price", "sales_account_id", "purchase_account_id", "tax_code_id", "is_active"],
    required: ["name", "unit", "default_unit_price"]
  }
};

function parseMatrix(text: string): { cells: string[]; line: number }[] {
  const result: { cells: string[]; line: number }[] = [];
  let row: { cells: string[]; line: number } = { cells: [], line: 1 };
  let field = ""; let quoted = false; let afterQuote = false; let line = 1;
  const pushField = () => { if (field.length > 4000) throw CommandError.validation({ file: "A CSV cell exceeds 4,000 characters." }); row.cells.push(field); field = ""; afterQuote = false; };
  const pushRow = () => { pushField(); if (row.cells.some(value => value.trim() !== "")) result.push(row); row = { cells: [], line: line + 1 }; };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else { field += ch; if (ch === "\n") line += 1; }
    } else if (ch === '"' && field.length === 0 && !afterQuote) quoted = true;
    else if (ch === ",") pushField();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      pushRow(); line += 1;
      if (result.length > 501) throw CommandError.validation({ file: "Imports support at most 500 data rows." });
    } else if (afterQuote && ch.trim() !== "") throw CommandError.validation({ file: "Unexpected content after a quoted CSV value." });
    else if (!afterQuote) field += ch;
  }
  if (quoted) throw CommandError.validation({ file: "The CSV contains an unterminated quoted value." });
  if (field.length || row.cells.length) pushRow();
  if (result.length > 501) throw CommandError.validation({ file: "Imports support at most 500 data rows." });
  return result;
}

export function parseMasterDataCsv(bytes: Uint8Array, type: ImportType): StagedCsvRow[] {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw CommandError.validation({ file: "Save the CSV as valid UTF-8 and try again." }); }
  const matrix = parseMatrix(text);
  if (matrix.length < 2) throw CommandError.validation({ file: "Include a header row and at least one data row." });
  const header = matrix[0]!.cells.map(value => value.trim().toLowerCase());
  if (!header.length || header.length > 20 || header.some(value => !value || !/^[a-z_]+$/.test(value)) || new Set(header).size !== header.length)
    throw CommandError.validation({ file: "Use unique column headers with letters and underscores." });
  const spec = columns[type];
  const unknown = header.filter(value => !spec.allowed.includes(value));
  const missing = spec.required.filter(value => !header.includes(value));
  if (unknown.length || missing.length) throw CommandError.validation({
    columns: `${missing.length ? `Required: ${missing.join(", ")}. ` : ""}${unknown.length ? `Unsupported: ${unknown.join(", ")}.` : ""}`.trim()
  });
  const rows = matrix.slice(1).map(({ cells, line }) => {
    if (cells.length > header.length && cells.slice(header.length).some(value => value.trim()))
      throw CommandError.validation({ file: `CSV row ${line} has more values than the header.` });
    const raw = Object.fromEntries(header.map((name, index) => [name, (cells[index] ?? "").trim()]));
    if (type === "contacts") {
      const bool = (name: string, fallback?: boolean): unknown => {
        const value = raw[name]; if (value === undefined && fallback !== undefined) return fallback;
        if (value === "true") return true; if (value === "false") return false;
        return value;
      };
      const terms = raw.payment_terms_days === undefined || raw.payment_terms_days === "" ? 0 : Number(raw.payment_terms_days);
      return { row_no: line, input_data: {
        display_name: raw.display_name, legal_name: raw.legal_name || null, is_customer: bool("is_customer"), is_vendor: bool("is_vendor"),
        email: raw.email || null, phone: raw.phone || null, billing_address: {}, tax_identifiers: {}, payment_terms_days: Number.isSafeInteger(terms) ? terms : raw.payment_terms_days,
        credit_limit: raw.credit_limit || null, external_key: raw.external_key || null, is_active: bool("is_active", true)
      } };
    }
    const active = raw.is_active === undefined || raw.is_active === "" || raw.is_active === "true" ? true : raw.is_active === "false" ? false : null;
    return { row_no: line, input_data: {
      sku: raw.sku || null, name: raw.name, unit: raw.unit, default_unit_price: raw.default_unit_price,
      sales_account_id: raw.sales_account_id || null, purchase_account_id: raw.purchase_account_id || null,
      tax_code_id: raw.tax_code_id || null, is_active: active ?? raw.is_active
    } };
  });
  if (!rows.length || rows.length > 500) throw CommandError.validation({ file: "Imports support 1 to 500 data rows." });
  return rows;
}
