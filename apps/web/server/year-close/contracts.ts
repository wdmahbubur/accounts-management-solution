import { parseUuid } from "@ams/contracts";

export type CloseKind = "journal" | "zero_nominal";
export type YearCloseReceipt = { runId: string; kind: CloseKind; status: "closed" | "reopened"; documentId: string | null; journalId: string | null };

export function parseYearCloseReceipt(raw: unknown, action: "close" | "reopen"): YearCloseReceipt {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The year-close result could not be confirmed. Retry the same request.");
  const data = raw as Record<string, unknown>, runId = parseUuid(data.run_id);
  const document = action === "close" ? data.document_id : data.reopen_document_id;
  // Earlier journal receipts remain replayable across the migration. A zero-
  // nominal receipt must explicitly identify itself and contain no journal.
  const kind = data.close_kind === undefined && typeof document === "string" ? "journal" : data.close_kind;
  const status = action === "close" ? "closed" : "reopened";
  if (data.status !== status || !["journal", "zero_nominal"].includes(String(kind))) throw new Error("The year-close result could not be confirmed. Retry the same request.");
  if (kind === "zero_nominal") {
    if (document !== null || data.journal_entry_id !== null || data.document_number !== null) throw new Error("The year-close result could not be confirmed. Retry the same request.");
    return { runId, kind, status, documentId: null, journalId: null };
  }
  const documentId = parseUuid(document), journalId = parseUuid(data.journal_entry_id);
  if (typeof data.document_number !== "string" || !data.document_number.trim()) throw new Error("The year-close result could not be confirmed. Retry the same request.");
  return { runId, kind: "journal", status, documentId, journalId };
}
