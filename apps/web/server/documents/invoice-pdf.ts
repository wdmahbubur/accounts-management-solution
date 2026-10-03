import "server-only";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";

function loadFont(filename: string): Buffer {
  const roots = [join(process.cwd(), "node_modules"), join(process.cwd(), "..", "..", "node_modules")];
  for (const root of roots) {
    try { return readFileSync(join(root, "@fontsource", "noto-sans-bengali", "files", filename)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  throw new Error("The Noto Sans Bengali PDF fonts are unavailable.");
}
const bengaliFont = loadFont("noto-sans-bengali-bengali-400-normal.woff");
const latinFont = loadFont("noto-sans-bengali-latin-400-normal.woff");
const bengaliBoldFont = loadFont("noto-sans-bengali-bengali-700-normal.woff");
const latinBoldFont = loadFont("noto-sans-bengali-latin-700-normal.woff");
type PdfDoc = InstanceType<typeof PDFDocument>;

/**
 * The caller must build this DTO from an issued invoice's immutable source,
 * party, line, and tax snapshots. It intentionally has no live contact or tax
 * configuration fields from which the invoice could be silently regenerated.
 */
export interface IssuedInvoicePdfSnapshot {
  state: "posted";
  documentId: string;
  documentNumber: string;
  materialDigest: string;
  documentVersion: number;
  issueDate: string;
  dueDate: string | null;
  currency: "BDT";
  netAmount: string;
  taxAmount: string;
  roundingAdjustment: string;
  totalAmount: string;
  company: {
    name: string;
    legalName: string | null;
    address: string | null;
    taxIdentifiers: ReadonlyArray<{ label: string; value: string }>;
  };
  customer: {
    displayName: string;
    legalName: string | null;
    email: string | null;
    phone: string | null;
    billingAddress: string | null;
    taxIdentifiers: ReadonlyArray<{ label: string; value: string }>;
  };
  lines: ReadonlyArray<{
    description: string;
    itemName: string | null;
    quantity: string;
    unit: string | null;
    unitPrice: string;
    discountAmount: string;
    taxLabel: string | null;
    taxRate: string;
    taxMode: "inclusive" | "exclusive";
    netAmount: string;
    taxAmount: string;
    grossAmount: string;
  }>;
}

export interface RenderedInvoicePdf {
  bytes: Buffer;
  filename: string;
  sha256: string;
  sourceDocumentId: string;
  sourceDocumentVersion: number;
  sourceMaterialDigest: string;
}

const PAGE = { width: 595.28, height: 841.89, margin: 42 };
const BENGALI = /[\u0980-\u09ff]/;
const MAX_TEXT = 2_000;

function clean(value: string | null | undefined, fallback = "—"): string {
  const normalized = value?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
  return normalized ? normalized.slice(0, MAX_TEXT) : fallback;
}

function date(value: string | null): string {
  if (!value) return "—";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "—";
}

function validMoney(value: string): string {
  if (!/^-?(?:0|[1-9]\d{0,13})\.\d{2}$/.test(value)) throw new Error("Invoice PDF snapshot contains invalid BDT amount.");
  return value;
}

function assertSnapshot(snapshot: IssuedInvoicePdfSnapshot): void {
  if (snapshot.state !== "posted" || snapshot.currency !== "BDT" || !snapshot.documentId || !snapshot.documentNumber ||
      !Number.isSafeInteger(snapshot.documentVersion) || snapshot.documentVersion < 1 || !/^[a-f\d]{64}$/i.test(snapshot.materialDigest) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.issueDate) || snapshot.lines.length < 1 || snapshot.lines.length > 500) {
    throw new Error("Invoice PDF requires a valid issued invoice snapshot.");
  }
  validMoney(snapshot.netAmount);
  validMoney(snapshot.taxAmount);
  validMoney(snapshot.roundingAdjustment);
  validMoney(snapshot.totalAmount);
  for (const line of snapshot.lines) {
    validMoney(line.unitPrice);
    validMoney(line.discountAmount);
    validMoney(line.netAmount);
    validMoney(line.taxAmount);
    validMoney(line.grossAmount);
    if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(line.quantity) || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(line.taxRate)) {
      throw new Error("Invoice PDF snapshot contains invalid quantity or tax rate.");
    }
  }
}

function addFonts(doc: PdfDoc): void {
  doc.registerFont("ams-regular-bn", bengaliFont);
  doc.registerFont("ams-regular-latin", latinFont);
  doc.registerFont("ams-bold-bn", bengaliBoldFont);
  doc.registerFont("ams-bold-latin", latinBoldFont);
}

/** Writes mixed Bengali and Latin runs using embedded Noto Sans subsets. */
function mixedText(doc: PdfDoc, text: string, x: number, y: number, width: number, options: { size?: number; bold?: boolean; color?: string } = {}): number {
  const size = options.size ?? 9;
  const bold = options.bold ?? false;
  const runs = text.match(/[\u0980-\u09ff][\u0980-\u09ff\u200c\u200d\u0980-\u09ff\s.,:;()/-]*|[^\u0980-\u09ff]+/gu) ?? [text];
  let cursor = x;
  let bottom = y;
  for (const run of runs) {
    const isBengali = BENGALI.test(run);
    doc.font(bold ? (isBengali ? "ams-bold-bn" : "ams-bold-latin") : (isBengali ? "ams-regular-bn" : "ams-regular-latin"));
    doc.fontSize(size);
    if (options.color) doc.fillColor(options.color);
    doc.text(run, cursor, y, { width: Math.max(1, width - (cursor - x)), lineBreak: true, continued: true, paragraphGap: 0 });
    cursor += doc.widthOfString(run);
    bottom = Math.max(bottom, doc.y);
  }
  doc.text("", x, y, { width, lineBreak: true, continued: false });
  return Math.max(bottom, doc.y);
}

function wrap(value: string, maximum: number): string[] {
  const words = clean(value, "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maximum && line) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["—"];
}

/** Render a deterministic, Unicode PDF from an immutable posted invoice snapshot. */
export async function renderIssuedInvoicePdf(snapshot: IssuedInvoicePdfSnapshot): Promise<RenderedInvoicePdf> {
  assertSnapshot(snapshot);
  const doc = new PDFDocument({ size: [PAGE.width, PAGE.height], margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin }, bufferPages: true, compress: true });
  addFonts(doc);
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const bodyWidth = right - left;
  let y = PAGE.margin;
  mixedText(doc, clean(snapshot.company.name), left, y, bodyWidth * 0.65, { size: 17, bold: true, color: "#123c4a" });
  y = doc.y + 2;
  if (snapshot.company.legalName) { y = mixedText(doc, clean(snapshot.company.legalName), left, y, bodyWidth * 0.65, { size: 9 }); y += 2; }
  if (snapshot.company.address) { y = mixedText(doc, clean(snapshot.company.address), left, y, bodyWidth * 0.65, { size: 8, color: "#425866" }); y += 2; }
  for (const identifier of snapshot.company.taxIdentifiers) {
    y = mixedText(doc, `${clean(identifier.label)}: ${clean(identifier.value)}`, left, y, bodyWidth * 0.65, { size: 8 }); y += 1;
  }
  doc.font("ams-bold-latin").fontSize(21).fillColor("#123c4a").text("INVOICE", right - 150, PAGE.margin + 2, { width: 150, align: "right" });
  doc.font("ams-regular-latin").fontSize(9).fillColor("#425866").text(clean(snapshot.documentNumber), right - 170, PAGE.margin + 32, { width: 170, align: "right" });
  y = Math.max(y, PAGE.margin + 58) + 17;

  doc.moveTo(left, y).lineTo(right, y).strokeColor("#cbd7dc").stroke();
  y += 13;
  mixedText(doc, "Bill to", left, y, bodyWidth / 2, { bold: true, size: 9, color: "#123c4a" });
  doc.font("ams-bold-latin").fontSize(9).fillColor("#123c4a").text("Invoice details", left + bodyWidth / 2, y, { width: bodyWidth / 2 });
  y += 16;
  const detailY = y;
  const customerLines = [clean(snapshot.customer.displayName), snapshot.customer.legalName, snapshot.customer.billingAddress,
    snapshot.customer.email, snapshot.customer.phone, ...snapshot.customer.taxIdentifiers.map((item) => `${clean(item.label)}: ${clean(item.value)}`)].filter(Boolean) as string[];
  for (const line of customerLines) { y = mixedText(doc, clean(line), left, y, bodyWidth / 2 - 18, { size: 8 }); y += 2; }
  let metaY = detailY;
  for (const [label, value] of [["Invoice number", snapshot.documentNumber], ["Issue date", date(snapshot.issueDate)], ["Due date", date(snapshot.dueDate)], ["Currency", "BDT"]] as const) {
    doc.font("ams-regular-latin").fontSize(8).fillColor("#425866").text(label, left + bodyWidth / 2, metaY, { width: 100 });
    doc.font("ams-bold-latin").fontSize(8).fillColor("#172b35").text(value, left + bodyWidth / 2 + 102, metaY, { width: bodyWidth / 2 - 102 });
    metaY += 15;
  }
  y = Math.max(y, metaY) + 14;

  const columns = { description: left, quantity: left + 260, unitPrice: left + 318, tax: left + 390, total: right - 70 };
  const drawTableHeader = () => {
    doc.save().rect(left, y, bodyWidth, 24).fill("#edf3f5").restore();
    mixedText(doc, "Description", columns.description + 7, y + 7, 246, { size: 8, bold: true });
    doc.font("ams-bold-latin").fontSize(8).fillColor("#123c4a").text("Qty", columns.quantity, y + 7, { width: 50, align: "right" });
    doc.text("Rate", columns.unitPrice, y + 7, { width: 62, align: "right" });
    doc.text("Tax", columns.tax, y + 7, { width: 58, align: "right" });
    doc.text("Amount", columns.total, y + 7, { width: 63, align: "right" });
    y += 29;
  };
  drawTableHeader();
  for (const line of snapshot.lines) {
    const description = line.itemName ? `${clean(line.description)} · ${clean(line.itemName)}` : clean(line.description);
    const descriptionLines = wrap(description, 52);
    const rowHeight = Math.max(30, descriptionLines.length * 12 + 10);
    if (y + rowHeight > PAGE.height - PAGE.margin - 150) { doc.addPage(); y = PAGE.margin; drawTableHeader(); }
    descriptionLines.forEach((part, index) => mixedText(doc, part, columns.description + 7, y + 6 + index * 11, 245, { size: 8 }));
    doc.font("ams-regular-latin").fontSize(8).fillColor("#172b35").text(clean(line.quantity), columns.quantity, y + 7, { width: 50, align: "right" });
    doc.text(validMoney(line.unitPrice), columns.unitPrice, y + 7, { width: 62, align: "right" });
    doc.text(`${clean(line.taxLabel, "Tax")} ${clean(line.taxRate)}%`, columns.tax - 4, y + 7, { width: 66, align: "right" });
    doc.font("ams-bold-latin").text(validMoney(line.grossAmount), columns.total, y + 7, { width: 63, align: "right" });
    y += rowHeight;
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#e1e8eb").stroke();
  }

  const totalsHeight = 105;
  if (y + totalsHeight > PAGE.height - PAGE.margin - 40) { doc.addPage(); y = PAGE.margin; }
  y += 14;
  const totalsLabelX = right - 205;
  const totalsValueX = right - 75;
  const totalRow = (label: string, value: string, emphasis = false) => {
    doc.font(emphasis ? "ams-bold-latin" : "ams-regular-latin").fontSize(emphasis ? 11 : 9).fillColor(emphasis ? "#123c4a" : "#425866").text(label, totalsLabelX, y, { width: 120 });
    doc.font(emphasis ? "ams-bold-latin" : "ams-regular-latin").fontSize(emphasis ? 11 : 9).fillColor(emphasis ? "#123c4a" : "#172b35").text(`BDT ${validMoney(value)}`, totalsValueX, y, { width: 75, align: "right" });
    y += emphasis ? 22 : 16;
  };
  totalRow("Subtotal", snapshot.netAmount);
  totalRow("Tax", snapshot.taxAmount);
  if (snapshot.roundingAdjustment !== "0.00") totalRow("Rounding adjustment", snapshot.roundingAdjustment);
  doc.moveTo(totalsLabelX, y - 4).lineTo(right, y - 4).strokeColor("#cbd7dc").stroke();
  totalRow("Total due (BDT)", snapshot.totalAmount, true);

  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const footerY = PAGE.height - PAGE.margin + 8;
    doc.moveTo(left, footerY - 8).lineTo(right, footerY - 8).strokeColor("#cbd7dc").stroke();
    mixedText(doc, "Issued invoice snapshot · This document does not record settlement.", left, footerY, bodyWidth - 100, { size: 7, color: "#60747d" });
    doc.font("ams-regular-latin").fontSize(7).fillColor("#60747d").text(`Page ${pageIndex + 1} of ${range.count}`, right - 90, footerY, { width: 90, align: "right" });
  }
  doc.end();
  const bytes = await completed;
  return {
    bytes,
    filename: `${snapshot.documentNumber.replace(/[^\p{L}\p{N}._-]+/gu, "-")}.pdf`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourceDocumentId: snapshot.documentId,
    sourceDocumentVersion: snapshot.documentVersion,
    sourceMaterialDigest: snapshot.materialDigest
  };
}
