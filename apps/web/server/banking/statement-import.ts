import "server-only";

import { createHash } from "node:crypto";
import ExcelJS from "exceljs";

const maxBytes = 8 * 1024 * 1024;
const maxRows = 10_000;
const maxColumns = 80;

export type StatementMapping = {
  date: number;
  description: number;
  amount?: number;
  debit?: number;
  credit?: number;
  valueDate?: number;
  balance?: number;
  reference?: number;
};

export type StatementRow = {
  row_no: number;
  transaction_date: string;
  value_date: string;
  description: string;
  amount: string;
  balance_after: string;
  source_transaction_id: string;
  fingerprint: string;
  raw_row: Record<string, string | number | boolean | null>;
};

function csvMatrix(input: string): unknown[][] {
  const result: unknown[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((cell) => String(cell).trim() !== "")) result.push(row);
      row = [];
      if (result.length > maxRows + 1) throw new Error("The file contains more than 10,000 data rows.");
    } else field += char;
  }
  if (quoted) throw new Error("The CSV contains an unterminated quoted value.");
  row.push(field);
  if (row.some((cell) => String(cell).trim() !== "")) result.push(row);
  if (result.length > maxRows + 1) throw new Error("The file contains more than 10,000 data rows.");
  return result;
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) throw new Error("Spreadsheet formula cells are not accepted. Save the statement as values and upload it again.");
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return value.result;
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    return null;
  }
  return value ?? null;
}

export async function readStatementMatrix(file: File): Promise<{ matrix: unknown[][]; sha256: string; bytes: Buffer }> {
  if (file.size < 1 || file.size > maxBytes) throw new Error("Choose a file between 1 byte and 8 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = file.name.toLowerCase();
  let matrix: unknown[][];
  if (filename.endsWith(".csv")) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    matrix = csvMatrix(text);
  } else if (filename.endsWith(".xlsx") && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const workbook = new ExcelJS.Workbook();
    const workbookBytes = Buffer.allocUnsafe(bytes.byteLength);
    bytes.copy(workbookBytes);
    await workbook.xlsx.load(workbookBytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    if (workbook.worksheets.length !== 1) throw new Error("Use an XLSX file with exactly one worksheet.");
    const sheet = workbook.worksheets[0]!;
    if (sheet.rowCount > maxRows + 1 || sheet.columnCount > maxColumns) throw new Error("The worksheet exceeds the supported row or column limit.");
    matrix = [];
    sheet.eachRow({ includeEmpty: false }, (row) => matrix.push(Array.from({ length: row.cellCount }, (_, index) => cellValue(row.getCell(index + 1).value))));
  } else {
    throw new Error("Use a UTF-8 CSV or a single-sheet XLSX file. Macro-enabled and other formats are not supported.");
  }
  if (!matrix.length || matrix[0]!.length > maxColumns || matrix.some((row) => row.length > maxColumns)) throw new Error("The statement has no header row or has too many columns.");
  return { matrix, sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
}

function dateValue(value: unknown): string {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00.000Z`);
    if (date.toISOString().slice(0, 10) === text) return text;
  }
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (match) {
    const day = Number(match[1]); const month = Number(match[2]); const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date.toISOString().slice(0, 10);
  }
  throw new Error("Use an unambiguous YYYY-MM-DD or DD/MM/YYYY date.");
}

function moneyValue(value: unknown, signed = false): string {
  const text = String(value ?? "").trim().replaceAll(",", "").replace(/^৳\s*/, "");
  if (!/^-?\d{1,12}(?:\.\d{1,2})?$/.test(text) || (!signed && text.startsWith("-"))) throw new Error("Use an exact BDT amount with up to two decimal places.");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  return `${text.startsWith("-") ? "-" : ""}${whole}.${fraction.padEnd(2, "0")}`;
}

export function mapStatementRows(matrix: unknown[][], mapping: StatementMapping): { rows: StatementRow[]; errors: { row_no: number; message: string }[]; preview: unknown[][]; repeatedFingerprints: number } {
  const errors: { row_no: number; message: string }[] = [];
  const rows: StatementRow[] = [];
  const headers = matrix[0]!.map((value) => String(value ?? "").slice(0, 160));
  const preview = matrix.slice(0, 6);
  for (let i = 1; i < matrix.length; i += 1) {
    const values = matrix[i]!;
    if (values.every((value) => String(value ?? "").trim() === "")) continue;
    const rowNo = i + 1;
    try {
      const rawRow: Record<string, string | number | boolean | null> = {};
      headers.forEach((header, index) => {
        const value = values[index];
        rawRow[header || `Column ${index + 1}`] = value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value) ? value as string | number | boolean | null ?? null : String(value);
      });
      const amount = mapping.amount !== undefined
        ? moneyValue(values[mapping.amount], true)
        : (() => { const debit = moneyValue(values[mapping.debit!]); const credit = moneyValue(values[mapping.credit!]); const debitN = Number(debit); const creditN = Number(credit); if ((debitN > 0) === (creditN > 0)) throw new Error("Enter a value in exactly one of debit or credit."); return debitN > 0 ? `-${debit}` : credit; })();
      if (/^-?0\.00$/.test(amount)) throw new Error("Zero-value rows are not imported.");
      const transactionDate = dateValue(values[mapping.date]);
      const valueDate = mapping.valueDate === undefined || !String(values[mapping.valueDate] ?? "").trim() ? "" : dateValue(values[mapping.valueDate]);
      const description = String(values[mapping.description] ?? "").trim();
      if (!description || description.length > 500) throw new Error("Description is required and must be at most 500 characters.");
      const balance = mapping.balance === undefined || !String(values[mapping.balance] ?? "").trim() ? "" : moneyValue(values[mapping.balance], true);
      const reference = mapping.reference === undefined ? "" : String(values[mapping.reference] ?? "").trim().slice(0, 160);
      const canonical = `${transactionDate}\0${description.toLocaleLowerCase()}\0${amount}`;
      rows.push({ row_no: rowNo, transaction_date: transactionDate, value_date: valueDate, description, amount, balance_after: balance, source_transaction_id: reference, fingerprint: createHash("sha256").update(canonical).digest("hex"), raw_row: rawRow });
    } catch (error) {
      errors.push({ row_no: rowNo, message: error instanceof Error ? error.message : "Invalid row." });
    }
  }
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.fingerprint, (counts.get(row.fingerprint) ?? 0) + 1);
  const repeatedFingerprints = [...counts.values()].filter((count) => count > 1).length;
  return { rows, errors, preview, repeatedFingerprints };
}
