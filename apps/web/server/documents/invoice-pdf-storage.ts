import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import type { ActorContext } from "../auth/types.ts";
import { CommandError } from "../commands/errors.ts";
import type { RequestClient } from "../request-client.ts";
import { readPrivateArtifact } from "../artifacts/download.ts";
import { listActiveMemberships } from "../companies/memberships.ts";
import { readFinancialDocument } from "./service.ts";
import { record } from "./contracts.ts";
import { deleteInvoicePdfObject, writeInvoicePdfObject } from "../storage/private.ts";
import { renderIssuedInvoicePdf, type IssuedInvoicePdfSnapshot } from "./invoice-pdf.ts";

type RpcClient = Pick<RequestClient, "rpc" | "auth">;
type PdfVersion = {
  pdfId: string;
  objectKey: string;
  filename: string;
  sha256: string;
  byteSize: number;
  documentVersion: number;
  materialDigest: string;
};

function dbError(error: { code?: string } | null): never {
  if (error?.code === "42501") throw CommandError.forbidden();
  if (error?.code === "P0002") throw CommandError.notFound();
  if (error?.code === "22023") throw CommandError.validation({ invoice: "The issued invoice snapshot is invalid." });
  if (error?.code === "23505" || error?.code === "40001") throw CommandError.conflict("STALE_VERSION");
  throw CommandError.transient();
}

function parseVersion(raw: unknown, organizationId: string): PdfVersion {
  const row = record(raw, "invoice_pdf");
  const pdfId = parseUuid(row.pdf_id, "pdf_id");
  const byteSize = row.byte_size;
  const documentVersion = row.source_document_version;
  if (typeof row.object_key !== "string" || row.object_key !== `${organizationId}/invoice-pdfs/${pdfId}` ||
      row.download_filename !== `invoice-${pdfId}.pdf` || typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256) ||
      !Number.isSafeInteger(byteSize) || Number(byteSize) < 1 || Number(byteSize) > 10 * 1024 * 1024 ||
      !Number.isSafeInteger(documentVersion) || Number(documentVersion) < 1 ||
      typeof row.source_material_digest !== "string" || !/^[0-9a-f]{64}$/.test(row.source_material_digest)) {
    throw new Error("Invalid invoice PDF version response.");
  }
  return { pdfId, objectKey: row.object_key, filename: row.download_filename, sha256: row.sha256,
    byteSize: Number(byteSize), documentVersion: Number(documentVersion), materialDigest: row.source_material_digest };
}

async function existingVersion(client: RpcClient, organizationId: string, documentId: string): Promise<PdfVersion | null> {
  const result = await client.rpc("read_invoice_pdf_version", { p_organization_id: organizationId, p_document_id: documentId });
  if (result.error) dbError(result.error);
  return result.data == null ? null : parseVersion(result.data, organizationId);
}

function jsonText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && item.trim()) parts.push(key.replaceAll("_", " ") + ": " + item.trim());
    else if (typeof item === "number" || typeof item === "boolean") parts.push(key.replaceAll("_", " ") + ": " + String(item));
    else if (item && typeof item === "object") {
      const nested = jsonText(item);
      if (nested) parts.push(nested);
    }
  }
  return parts.join(" · ") || null;
}

function pairs(value: unknown): { label: string; value: string }[] {
  if (Array.isArray(value)) return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    return typeof row.value === "string" ? [{ label: String(row.label ?? "Tax ID"), value: row.value }] : [];
  });
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>)
    .flatMap(([label, item]) => typeof item === "string" && item.trim() ? [{ label, value: item }] : []);
  return [];
}

function buildSnapshot(document: Record<string, unknown>, company: { organizationName: string; legalName: string }, documentId: string): IssuedInvoicePdfSnapshot {
  if (document.document_type !== "invoice" || document.state !== "posted" || typeof document.material_digest !== "string" ||
      typeof document.version !== "number" || typeof document.document_number !== "string" || typeof document.issue_date !== "string" ||
      typeof document.net_amount !== "string" || typeof document.tax_amount !== "string" || typeof document.total_amount !== "string" ||
      !Array.isArray(document.lines)) throw CommandError.conflict("STALE_VERSION");
  const party = document.party_snapshot && typeof document.party_snapshot === "object" && !Array.isArray(document.party_snapshot)
    ? document.party_snapshot as Record<string, unknown> : {};
  const lines = document.lines.map((raw) => {
    const line = record(raw, "invoice_line");
    const item = line.item_snapshot && typeof line.item_snapshot === "object" && !Array.isArray(line.item_snapshot)
      ? line.item_snapshot as Record<string, unknown> : {};
    if ([line.description, line.quantity, line.unit_price, line.discount_amount, line.tax_rate_snapshot, line.net_amount, line.tax_amount, line.gross_amount]
      .some((field) => typeof field !== "string")) throw new Error("Issued invoice line snapshot is incomplete.");
    return {
      description: line.description as string,
      itemName: typeof item.name === "string" ? item.name : null,
      quantity: line.quantity as string,
      unit: typeof item.unit === "string" ? item.unit : null,
      unitPrice: line.unit_price as string,
      discountAmount: line.discount_amount as string,
      taxLabel: typeof line.tax_label_snapshot === "string" ? line.tax_label_snapshot : null,
      taxRate: line.tax_rate_snapshot as string,
      taxMode: line.tax_mode === "inclusive" ? "inclusive" as const : "exclusive" as const,
      netAmount: line.net_amount as string,
      taxAmount: line.tax_amount as string,
      grossAmount: line.gross_amount as string
    };
  });
  return {
    state: "posted", documentId, documentNumber: document.document_number, materialDigest: document.material_digest,
    documentVersion: document.version, issueDate: document.issue_date,
    dueDate: typeof document.due_date === "string" ? document.due_date : null, currency: "BDT",
    netAmount: document.net_amount, taxAmount: document.tax_amount,
    roundingAdjustment: typeof document.rounding_adjustment === "string" ? document.rounding_adjustment : "0.00",
    totalAmount: document.total_amount,
    company: { name: company.organizationName, legalName: company.legalName || null, address: null, taxIdentifiers: [] },
    customer: {
      displayName: typeof party.display_name === "string" ? party.display_name : "Customer",
      legalName: typeof party.legal_name === "string" ? party.legal_name : null,
      email: typeof party.email === "string" ? party.email : null,
      phone: typeof party.phone === "string" ? party.phone : null,
      billingAddress: jsonText(party.billing_address), taxIdentifiers: pairs(party.tax_identifiers)
    }, lines
  };
}

async function readBytes(client: RpcClient, organizationId: string, documentId: string, version: PdfVersion) {
  const artifact = await readPrivateArtifact(client, organizationId, "invoice-pdfs", version.pdfId);
  const bytes = Buffer.from(await artifact.bytes.arrayBuffer());
  if (bytes.byteLength !== version.byteSize || createHash("sha256").update(bytes).digest("hex") !== version.sha256) throw CommandError.notFound();
  const stillCurrent = await existingVersion(client, organizationId, documentId);
  if (!stillCurrent || stillCurrent.pdfId !== version.pdfId || stillCurrent.sha256 !== version.sha256) throw CommandError.notFound();
  return bytes;
}

/** Return the current issued PDF, creating one immutable version on first retrieval. */
export async function getIssuedInvoicePdf(client: RpcClient, actor: ActorContext, rawDocumentId: string) {
  if (!actor.capabilities.includes("sales.read")) throw CommandError.forbidden();
  const organizationId = parseOrganizationId(actor.organizationId);
  const documentId = parseUuid(rawDocumentId, "document_id");
  const available = await existingVersion(client, organizationId, documentId);
  if (available) return { bytes: await readBytes(client, organizationId, documentId, available), filename: available.filename };

  const memberships = await listActiveMemberships(client);
  const company = memberships.find((item) => item.organizationId === organizationId);
  if (!company) throw CommandError.notFound();
  const document = await readFinancialDocument(client, actor, documentId);
  const rendered = await renderIssuedInvoicePdf(buildSnapshot(record(document, "document"), company, documentId));
  const pdfId = parseUuid(randomUUID(), "pdf_id");
  const objectKey = `${organizationId}/invoice-pdfs/${pdfId}`;
  if (!await writeInvoicePdfObject(objectKey, rendered.bytes)) throw CommandError.transient();

  const result = await client.rpc("register_invoice_pdf_version", {
    p_organization_id: organizationId, p_document_id: documentId, p_pdf_id: pdfId,
    p_source_document_version: rendered.sourceDocumentVersion, p_source_material_digest: rendered.sourceMaterialDigest,
    p_sha256: rendered.sha256, p_byte_size: rendered.bytes.byteLength
  });
  if (result.error) {
    // Keep an object if the database outcome is ambiguous; deleting it could race a committed registration.
    if (["42501", "P0002", "22023", "23505", "40001"].includes(result.error.code ?? "")) await deleteInvoicePdfObject(objectKey);
    dbError(result.error);
  }
  const registered = parseVersion(result.data, organizationId);
  if (registered.pdfId !== pdfId) await deleteInvoicePdfObject(objectKey);
  const bytes = await readBytes(client, organizationId, documentId, registered);
  return { bytes, filename: registered.filename };
}
