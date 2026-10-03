import { createHash } from "node:crypto";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import type { RequestClient } from "../request-client.ts";
import { CommandError } from "../commands/errors.ts";
import { record } from "../roles/contracts.ts";
import { readPrivateObject, writeQuarantinedObject } from "../storage/private.ts";

const maxBytes = 10 * 1024 * 1024;
const mimeExtensions: Record<string, string[]> = {
  "application/pdf": ["pdf"], "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"],
  "image/webp": ["webp"], "text/plain": ["txt"], "text/csv": ["csv"]
};

function verifyContent(bytes: Uint8Array, contentType: string, filename: string): void {
  const ext = filename.split(".").at(-1)?.toLowerCase() ?? "";
  if (!mimeExtensions[contentType]?.includes(ext) || /[/\\\u0000-\u001f\u007f]/.test(filename) || filename === "." || filename === "..") {
    throw CommandError.validation({ file: "Use a safe filename with an allowed extension." });
  }
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  let valid = false;
  if (contentType === "application/pdf") valid = new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
  else if (contentType === "image/jpeg") valid = starts(0xff, 0xd8, 0xff);
  else if (contentType === "image/png") valid = starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  else if (contentType === "image/webp") valid = new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP";
  else {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      valid = !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
    } catch { valid = false; }
  }
  if (!valid) throw CommandError.validation({ file: "File content does not match the selected file type." });
}

function rpcFailure(error: unknown): never {
  const err = error as { code?: string };
  if (err.code === "42501") throw CommandError.forbidden();
  if (err.code === "P0002") throw CommandError.notFound();
  if (err.code === "22023") throw CommandError.validation({ file: "Upload details are invalid." });
  throw CommandError.transient();
}

export async function createUploadIntent(client: Pick<RequestClient, "rpc">, rawOrg: string, input: unknown) {
  const organizationId = parseOrganizationId(rawOrg);
  if (!input || typeof input !== "object") throw CommandError.validation({ body: "Upload details are required." });
  const body = input as Record<string, unknown>;
  const documentId = parseUuid(body.document_id);
  const filename = typeof body.filename === "string" ? body.filename.normalize("NFC") : "";
  const contentType = typeof body.content_type === "string" ? body.content_type : "";
  const byteSize = body.byte_size;
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
  if (filename.length < 1 || filename.length > 180 || /[/\\\u0000-\u001f\u007f]/.test(filename) || filename === "." || filename === "..")
    throw CommandError.validation({ filename: "Use a safe filename without path separators." });
  if (!Number.isSafeInteger(byteSize) || Number(byteSize) < 1 || Number(byteSize) > maxBytes) throw CommandError.validation({ byte_size: "File must be at most 10 MiB." });
  if (!mimeExtensions[contentType] || !/^[0-9a-f]{64}$/.test(sha256)) throw CommandError.validation({ content_type: "File type or SHA-256 is invalid." });
  const result = await client.rpc("create_attachment_upload_intent", { p_organization_id: organizationId,
    p_document_id: documentId, p_filename: filename, p_content_type: contentType, p_byte_size: byteSize, p_sha256: sha256 });
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) rpcFailure(result.error);
  const intent = record(result.data[0]);
  if (typeof intent.intent_id !== "string" || typeof intent.object_key !== "string" || typeof intent.expires_at !== "string" ||
    intent.object_key !== `${organizationId}/attachments/${intent.intent_id}`) throw CommandError.transient();
  return { intent_id: intent.intent_id, expires_at: intent.expires_at, upload_url: `/api/v1/organizations/${organizationId}/attachments/uploads/${intent.intent_id}/complete` };
}

export async function completeUpload(client: Pick<RequestClient, "rpc">, rawOrg: string, rawIntent: string, file: File) {
  const organizationId = parseOrganizationId(rawOrg); const intentId = parseUuid(rawIntent);
  if (!file || file.size < 1 || file.size > maxBytes || !mimeExtensions[file.type]) throw CommandError.validation({ file: "Unsupported or oversized file." });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw CommandError.validation({ file: "File size changed during upload." });
  verifyContent(bytes, file.type, file.name.normalize("NFC"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const key = `${organizationId}/attachments/${intentId}`;
  if (!await writeQuarantinedObject(key, bytes)) {
    const existing = await readPrivateObject(key);
    if (!existing || createHash("sha256").update(existing).digest("hex") !== sha256) throw CommandError.transient();
  }
  const result = await client.rpc("complete_attachment_upload", { p_organization_id: organizationId,
    p_intent_id: intentId, p_filename: file.name.normalize("NFC"), p_content_type: file.type,
    p_byte_size: bytes.byteLength, p_sha256: sha256 });
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) rpcFailure(result.error);
  const completed = record(result.data[0]);
  if (completed.attachment_id !== intentId || completed.scan_status !== "pending") throw CommandError.transient();
  return { attachment_id: intentId, scan_status: "pending_scan", downloadable: false } as const;
}
