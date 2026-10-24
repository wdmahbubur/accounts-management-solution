import { parseUuid } from "@ams/contracts";

export type Evidence = {
  attachment_id: string; filename: string; content_type: string; byte_size: number;
  scan_status: "pending" | "clean" | "rejected"; uploaded_at: string; uploader: string;
  source_id: string; source_type: string; source_number: string | null; source_date: string | null;
};

export function parseEvidence(value: unknown): Evidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid evidence row.");
  const row = value as Record<string, unknown>;
  const byteSize = typeof row.byte_size === "string" && /^[1-9]\d{0,7}$/.test(row.byte_size) ? Number(row.byte_size) : row.byte_size;
  parseUuid(row.attachment_id); parseUuid(row.source_id);
  if (typeof row.filename !== "string" || typeof row.content_type !== "string" || !Number.isSafeInteger(byteSize) || Number(byteSize) < 1 || Number(byteSize) > 10485760
    || typeof row.scan_status !== "string" || !["pending", "clean", "rejected"].includes(row.scan_status)
    || typeof row.uploaded_at !== "string" || !Number.isFinite(Date.parse(row.uploaded_at))
    || typeof row.uploader !== "string" || typeof row.source_type !== "string"
    || (row.source_number !== null && typeof row.source_number !== "string")
    || (row.source_date !== null && (typeof row.source_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.source_date)
      || !Number.isFinite(Date.parse(`${row.source_date}T00:00:00Z`)) || new Date(`${row.source_date}T00:00:00Z`).toISOString().slice(0, 10) !== row.source_date))) throw new Error("Invalid evidence row.");
  return { ...row, byte_size: byteSize } as Evidence;
}

export function evidenceUploadDate(value: string, timezone: string) {
  return new Date(value).toLocaleDateString("en", { timeZone: timezone, dateStyle: "medium" });
}

export function evidenceSourceDate(value: string | null) {
  return value === null ? "Accounting date available after posting" : new Date(`${value}T00:00:00Z`).toLocaleDateString("en", { timeZone: "UTC", dateStyle: "medium" });
}
