import { attachmentMimeExtensions, MAX_BROWSER_ATTACHMENT_BYTES, parseUuid } from "@ams/contracts";

export async function attachmentMetadata(file: File) {
  const name = file.name.normalize("NFC"), extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  if (file.size < 1 || file.size > MAX_BROWSER_ATTACHMENT_BYTES) throw new Error("Choose a file up to 4 MB.");
  if (name.length < 1 || name.length > 180 || /[/\\\u0000-\u001f\u007f]/.test(name) || !attachmentMimeExtensions[file.type]?.includes(extension)) {
    throw new Error("Choose a PDF, JPEG, PNG, WebP, CSV or text file with a safe name.");
  }
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return { filename: name, content_type: file.type, byte_size: file.size, sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The upload result could not be confirmed. Retry the same file.");
  return value as Record<string, unknown>;
}

export function attachmentIntent(raw: unknown, organizationId: string) {
  const data = record(raw), id = parseUuid(data.intent_id);
  const url = `/api/v1/organizations/${organizationId}/attachments/uploads/${id}/complete`;
  if (data.upload_url !== url || typeof data.expires_at !== "string" || !Number.isFinite(Date.parse(data.expires_at))) {
    throw new Error("The upload result could not be confirmed. Retry the same file.");
  }
  return { id, url };
}

export function attachmentResult(raw: unknown, expectedId: string) {
  const data = record(raw), id = parseUuid(data.attachment_id), status = data.scan_status;
  if (id !== expectedId || !["pending_scan", "clean", "rejected"].includes(String(status)) || data.downloadable !== (status === "clean")) {
    throw new Error("The upload result could not be confirmed. Retry the same file.");
  }
  return { id, status: status as "pending_scan" | "clean" | "rejected", downloadable: status === "clean" };
}
