import "server-only";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { withDatabase } from "../database.ts";
import { readPrivateObject } from "../storage/private.ts";
import { deletePrivateExport, putPrivateExport } from "./private-storage.ts";

type ExportJob = {
  job_id: string;
  organization_id: string;
  requester_member_id: string;
  company_name: string;
  parameters: { as_of?: unknown };
  ledger_cutoff_at: string;
  created_at: string;
  lease_token: string;
  attempt_count: number;
};
type ReportSnapshot = {
  report_type: string; company: { name: string; timezone?: string }; filters: Record<string, unknown>;
  generated_at: string; ledger_cutoff_at: string; provisional?: boolean; status?: string; data: unknown; export_format: "csv" | "pdf" | "xlsx";
};
type ExportRow = {
  company_name: string; currency: string; as_of: string; ledger_cutoff_at: string; generated_at: string;
  account_code: string; account_name: string; account_type: string; opening_balance: string;
  movement_debit: string; movement_credit: string; closing_debit: string; closing_credit: string;
};

function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function money(value: string): string {
  if (!/^-?\d{1,18}(?:\.\d{1,2})?$/.test(value)) throw Object.assign(new Error("Invalid database amount"), { safeCode: "EXPORT_INVALID_REPORT_DATA" });
  return value;
}
function numericCell(value: string): string {
  return `"${money(value)}"`;
}

function renderCsv(rows: ExportRow[]): Uint8Array {
  if (!rows.length) throw Object.assign(new Error("Trial balance has no account rows"), { safeCode: "EXPORT_EMPTY_REPORT" });
  const first = rows[0]!;
  const lines = [
    ["Report", "Trial balance"], ["Company", first.company_name], ["As of", first.as_of], ["Currency", first.currency],
    ["Generated at", first.generated_at], ["Ledger cutoff at", first.ledger_cutoff_at], ["Provisional", "No"], [],
    ["Account code", "Account name", "Account type", "Opening balance", "Movement debit", "Movement credit", "Closing debit", "Closing credit"],
    ...rows.map((row) => [row.account_code, row.account_name, row.account_type, row.opening_balance,
      row.movement_debit, row.movement_credit, row.closing_debit, row.closing_credit])
  ];
  const csv = "\uFEFF" + lines.map((line, lineIndex) => line.map((value, column) =>
    lineIndex >= 9 && column >= 3 ? numericCell(value) : csvCell(value)
  ).join(",")).join("\r\n") + "\r\n";
  return new TextEncoder().encode(csv);
}

function flatten(value: unknown, path = "report", rows: Array<[string, string]> = []): Array<[string, string]> {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index + 1}]`, rows));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) flatten(child, `${path}.${key}`, rows);
  } else if (value !== null && value !== undefined) {
    rows.push([path, String(value)]);
  }
  return rows;
}

function renderReportCsv(snapshot: ReportSnapshot): Uint8Array {
  if (!snapshot.company || typeof snapshot.company.name !== "string" || typeof snapshot.generated_at !== "string" ||
    typeof snapshot.ledger_cutoff_at !== "string" || !snapshot.data || typeof snapshot.data !== "object") {
    throw Object.assign(new Error("Invalid report snapshot"), { safeCode: "EXPORT_INVALID_REPORT_DATA" });
  }
  const metadata: Array<[string, string]> = [
    ["Report", snapshot.report_type.replaceAll("_", " ")], ["Company", snapshot.company.name],
    ["Currency", "BDT"], ["Generated at", snapshot.generated_at], ["Ledger cutoff at", snapshot.ledger_cutoff_at],
    ["Provisional", snapshot.provisional ? "Yes" : "No"], ["Status", snapshot.status ?? "posted"],
    ...Object.entries(snapshot.filters ?? {}).map(([key, value]): [string, string] => [`Filter: ${key}`, String(value ?? "")])
  ];
  const lines = [...metadata.map(([key, value]) => [csvCell(key), csvCell(value)]), [],
    [csvCell("Snapshot field"), csvCell("Value")],
    ...flatten(snapshot.data).map(([key, value]) => [csvCell(key), /^-?(0|[1-9]\d{0,17})(\.\d{1,2})?$/.test(value) ? numericCell(value) : csvCell(value)])];
  return new TextEncoder().encode("\uFEFF" + lines.map((line) => line.join(",")).join("\r\n") + "\r\n");
}

function renderReportXlsx(snapshot: ReportSnapshot): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Accounts Management Solution";
  workbook.created = new Date(snapshot.generated_at);
  const sheet = workbook.addWorksheet(snapshot.report_type.replaceAll("_", " ").slice(0, 31));
  const metadata: Array<[string, string]> = [
    ["Report", snapshot.report_type.replaceAll("_", " ")], ["Company", snapshot.company.name], ["Currency", "BDT"],
    ["Generated at", snapshot.generated_at], ["Ledger cutoff at", snapshot.ledger_cutoff_at],
    ["Provisional", snapshot.provisional ? "Yes" : "No"], ["Status", snapshot.status ?? "posted"],
    ...Object.entries(snapshot.filters ?? {}).map(([key, value]): [string, string] => [`Filter: ${key}`, String(value ?? "")])
  ];
  for (const row of metadata) sheet.addRow(row);
  sheet.addRow([]); sheet.addRow(["Snapshot field", "Value"]);
  for (const [key, value] of flatten(snapshot.data)) sheet.addRow([key, value]);
  sheet.getColumn(1).width = 52; sheet.getColumn(2).width = 72;
  sheet.getRow(metadata.length + 2).font = { bold: true };
  return workbook.xlsx.writeBuffer().then((bytes) => new Uint8Array(bytes));
}

function fontFile(name: string): Buffer {
  for (const root of [join(globalThis.process.cwd(), "node_modules"), join(globalThis.process.cwd(), "..", "..", "node_modules")]) {
    try { return readFileSync(join(root, "@fontsource", "noto-sans-bengali", "files", name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  throw Object.assign(new Error("Report PDF fonts unavailable"), { safeCode: "EXPORT_FONT_UNAVAILABLE" });
}
const bengali = /[\u0980-\u09ff]/;

function reportPdfText(doc: InstanceType<typeof PDFDocument>, text: string, bold = false, size = 9) {
  const safe = text.replace(/[\u0000-\u001f\u007f]/g, " ");
  const runs = safe.match(/[\u0980-\u09ff][\u0980-\u09ff\u200c\u200d\s.,:;()/-]*|[^\u0980-\u09ff]+/gu) ?? [safe];
  const x = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const lineHeight = size * 1.3;
  let cursor = x;
  let lineY = doc.y;
  if (lineY + lineHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
    lineY = doc.y;
  }
  for (const run of runs) {
    const bn = bengali.test(run);
    doc.font(bold ? (bn ? "ams-bold-bn" : "ams-bold-latin") : (bn ? "ams-regular-bn" : "ams-regular-latin"));
    const tokens = run.match(/\s+|\S+/gu) ?? [run];
    for (const token of tokens) {
      const tokenWidth = doc.widthOfString(token);
      if (cursor > x && cursor + tokenWidth > right && token.trim()) {
        lineY += lineHeight;
        if (lineY + lineHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          lineY = doc.y;
        }
        cursor = x;
      }
      if (!(cursor === x && !token.trim())) {
        doc.text(token, cursor, lineY, { lineBreak: false });
        cursor += tokenWidth;
      }
    }
  }
  doc.y = lineY + lineHeight;
}

async function renderReportPdf(snapshot: ReportSnapshot): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: false });
  doc.registerFont("ams-regular-bn", fontFile("noto-sans-bengali-bengali-400-normal.woff"));
  doc.registerFont("ams-regular-latin", fontFile("noto-sans-bengali-latin-400-normal.woff"));
  doc.registerFont("ams-bold-bn", fontFile("noto-sans-bengali-bengali-700-normal.woff"));
  doc.registerFont("ams-bold-latin", fontFile("noto-sans-bengali-latin-700-normal.woff"));
  const parts: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (part: Buffer) => parts.push(part));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    doc.on("error", reject);
  });
  doc.fontSize(16); reportPdfText(doc, snapshot.report_type.replaceAll("_", " "), true, 16);
  doc.moveDown(0.5); doc.fontSize(9);
  for (const [key, value] of [["Company", snapshot.company.name], ["Currency", "BDT"], ["Generated at", snapshot.generated_at],
    ["Ledger cutoff at", snapshot.ledger_cutoff_at], ["Provisional", snapshot.provisional ? "Yes" : "No"], ["Status", snapshot.status ?? "posted"],
    ...Object.entries(snapshot.filters ?? {}).map(([key, value]) => [`Filter: ${key}`, String(value ?? "")])]) {
    reportPdfText(doc, `${key}: ${value}`, false, 9); doc.moveDown(0.2);
  }
  doc.moveDown(0.5); doc.fontSize(10); reportPdfText(doc, "Snapshot details", true, 10); doc.moveDown(0.3); doc.fontSize(8);
  for (const [key, value] of flatten(snapshot.data)) {
    reportPdfText(doc, `${key}: ${value}`, false, 8); doc.moveDown(0.15);
  }
  doc.end();
  return new Uint8Array(await finished);
}

function errorCode(error: unknown): string {
  const safe = (error as { safeCode?: unknown }).safeCode;
  return typeof safe === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(safe) ? safe : "EXPORT_RENDER_FAILED";
}

async function process(job: ExportJob): Promise<"completed" | "retried" | "stale"> {
  const key = `${job.organization_id}/exports/${job.job_id}`;
  try {
    const report = await withDatabase((client) => client.query<{ snapshot: ReportSnapshot | null }>(
      "SELECT finance_private.read_report_export_snapshot($1::uuid,$2::uuid) AS snapshot", [job.job_id, job.lease_token]
    ));
    let bytes: Uint8Array;
    if (report.rows[0]?.snapshot) {
      const snapshot = report.rows[0].snapshot;
      if (snapshot.export_format === "xlsx") bytes = await renderReportXlsx(snapshot);
      else if (snapshot.export_format === "pdf") bytes = await renderReportPdf(snapshot);
      else if (snapshot.export_format === "csv") bytes = renderReportCsv(snapshot);
      else throw Object.assign(new Error("Unsupported report export format"), { safeCode: "EXPORT_INVALID_REPORT_DATA" });
    } else {
      const result = await withDatabase((client) => client.query<ExportRow>(
        "SELECT * FROM finance_private.read_trial_balance_export($1::uuid,$2::uuid)", [job.job_id, job.lease_token]
      ));
      bytes = renderCsv(result.rows);
    }
    if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024) {
      throw Object.assign(new Error("Export exceeds the private file limit"), { safeCode: "EXPORT_OUTPUT_TOO_LARGE" });
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (!await putPrivateExport(key, bytes)) {
      const existing = await readPrivateObject(key);
      if (!existing || createHash("sha256").update(existing).digest("hex") !== digest) {
        throw Object.assign(new Error("Private export storage unavailable"), { safeCode: "EXPORT_STORAGE_FAILED" });
      }
    }
    const completed = await withDatabase((client) => client.query<{ completed: boolean }>(
      "SELECT finance_private.complete_trial_balance_export($1::uuid,$2::uuid,$3::bigint,$4::text) AS completed",
      [job.job_id, job.lease_token, bytes.byteLength, digest]
    ));
    if (completed.rows[0]?.completed) return "completed";
    await deletePrivateExport(key);
    return "stale";
  } catch (error) {
    // A stale lease belongs to a replacement worker. Its result must not be overwritten or deleted.
    const code = errorCode(error);
    try {
      await withDatabase((client) => client.query(
        "SELECT finance_private.fail_trial_balance_export($1::uuid,$2::uuid,$3::text)", [job.job_id, job.lease_token, code]
      ));
      await deletePrivateExport(key);
      return "retried";
    } catch { return "stale"; }
  }
}

export async function processTrialBalanceExportBatch(limit = 3) {
  const claimed = await withDatabase((client) => client.query<ExportJob>(
    "SELECT * FROM finance_private.claim_trial_balance_exports($1::integer,$2::integer)", [limit, 600]
  ));
  let completed = 0; let retried = 0; let stale = 0;
  for (const job of claimed.rows) {
    const result = await process(job);
    if (result === "completed") completed++;
    else if (result === "retried") retried++;
    else stale++;
  }
  return { claimed: claimed.rowCount ?? claimed.rows.length, completed, retried, stale };
}
