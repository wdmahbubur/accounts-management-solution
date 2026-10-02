import { createHash } from "node:crypto";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { createSupabaseIdentityVerifier } from "../auth/supabase-identity.ts";
import { assertMutationOrigin } from "../auth/mutation-origin.ts";
import { resolveActorContext } from "../auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../commands/errors.ts";
import { generateRequestId } from "../commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../company-context.ts";
import { roleRuntime } from "../roles/runtime.ts";
import { PRIVATE_ARTIFACT_BUCKET, MAX_PRIVATE_ARTIFACT_BYTES } from "./download.ts";

const noStore = { "Cache-Control": "private, no-store" };
const contentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
type IntentInput = { documentId: string; filename: string; contentType: string; size: number };

function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw CommandError.validation({ body: "Expected an object." });
  return value as Record<string, unknown>;
}
function intentInput(raw: unknown): IntentInput {
  const value = body(raw);
  if (Object.keys(value).some((key) => !["document_id", "filename", "content_type", "size"].includes(key))) {
    throw CommandError.validation({ body: "Unexpected upload field." });
  }
  if (typeof value.filename !== "string" || !value.filename.trim() || value.filename.length > 180 ||
    /[\x00-\x1f\x7f/\\]/.test(value.filename)) throw CommandError.validation({ filename: "Use a filename without path separators or control characters." });
  if (typeof value.content_type !== "string" || !contentTypes.has(value.content_type)) {
    throw CommandError.validation({ content_type: "Only PDF, JPEG and PNG evidence is supported." });
  }
  if (!Number.isSafeInteger(value.size) || Number(value.size) < 1 || Number(value.size) > MAX_PRIVATE_ARTIFACT_BYTES) {
    throw CommandError.validation({ size: "Files must be between 1 byte and 10 MiB." });
  }
  return { documentId: parseUuid(value.document_id, "document_id"), filename: value.filename.trim(),
    contentType: value.content_type, size: Number(value.size) };
}
function sniff(bytes: Buffer): string | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}
function failure(error: unknown) {
  const safe = error instanceof StaleCompanyContextError
    ? new CommandError({ code: "STALE_VERSION", message: "Company context changed. Reload before uploading." })
    : normalizeCommandError(error);
  return Response.json(commandErrorBody(safe, generateRequestId()), { status: safe.status, headers: noStore });
}
async function authorizeMutation(request: Request, rawOrganizationId: string) {
  assertMutationOrigin(request.headers);
  const organizationId = parseOrganizationId(rawOrganizationId);
  const runtime = await roleRuntime();
  assertFreshCompanySubmission({ expectedOrganizationId: organizationId,
    expectedNonce: request.headers.get("x-company-context"), current: runtime.current });
  const actor = await resolveActorContext(organizationId, runtime.dependencies);
  if (!actor.capabilities.includes("attachments.write")) throw CommandError.forbidden();
  if (!await createSupabaseIdentityVerifier(runtime.client).verifyIdentity()) throw CommandError.unauthenticated();
  return { organizationId, runtime, actor };
}
export async function createAttachmentUploadIntent(request: Request, rawOrganizationId: string) {
  try {
    const { organizationId, runtime } = await authorizeMutation(request, rawOrganizationId);
    let raw: unknown;
    try { raw = await request.json(); } catch { throw CommandError.validation({ body: "Expected JSON." }); }
    const input = intentInput(raw);
    const result = await runtime.client.rpc("create_attachment_upload_intent", {
      p_organization_id: organizationId, p_document_id: input.documentId, p_filename: input.filename,
      p_content_type: input.contentType, p_size: input.size, p_request_id: generateRequestId()
    });
    if (result.error) throw result.error;
    const row = Array.isArray(result.data) ? result.data[0] : null;
    if (!row || typeof row.intent_id !== "string" || typeof row.object_key !== "string" || typeof row.expires_at !== "string") {
      throw new Error("Invalid upload intent response.");
    }
    const intentId = parseUuid(row.intent_id);
    if (row.object_key !== `${organizationId}/attachments/${intentId}` || Number.isNaN(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) {
      throw new Error("Invalid upload intent scope or expiration.");
    }
    return Response.json({ data: { intentId, expiresAt: row.expires_at,
      uploadPath: `/api/v1/organizations/${organizationId}/attachments/${intentId}/complete` },
      meta: { request_id: generateRequestId(), replayed: false } }, { status: 201, headers: noStore });
  } catch (error) { return failure(error); }
}
export async function completeAttachmentUpload(request: Request, rawOrganizationId: string, rawIntentId: string) {
  try {
    const { organizationId, runtime } = await authorizeMutation(request, rawOrganizationId);
    const intentId = parseUuid(rawIntentId, "intent_id");
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) < 1 || Number(declaredLength) > MAX_PRIVATE_ARTIFACT_BYTES)) {
      throw CommandError.validation({ file: "Evidence must be between 1 byte and 10 MiB." });
    }
    const intent = await runtime.client.rpc("read_attachment_upload_intent", { p_organization_id: organizationId, p_intent_id: intentId });
    if (intent.error || !Array.isArray(intent.data) || intent.data.length !== 1) throw CommandError.notFound();
    const row = body(intent.data[0]);
    if (typeof row.object_key !== "string" || row.object_key !== `${organizationId}/attachments/${intentId}` ||
      typeof row.declared_content_type !== "string" || typeof row.expected_size !== "number" ||
      row.expected_size < 1 || row.expected_size > MAX_PRIVATE_ARTIFACT_BYTES ||
      (declaredLength !== null && Number(declaredLength) !== row.expected_size) || typeof row.original_filename !== "string" ||
      (row.state !== "pending" && row.state !== "completed")) throw CommandError.notFound();
    if (request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() !== "application/octet-stream") {
      throw CommandError.validation({ content_type: "Upload the file bytes as application/octet-stream." });
    }
    if (!request.body) throw CommandError.validation({ file: "Evidence file body is missing." });
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        total += part.value.byteLength;
        if (total > row.expected_size || total > MAX_PRIVATE_ARTIFACT_BYTES) {
          await reader.cancel(); throw CommandError.validation({ file: "Uploaded bytes exceed the intent size limit." });
        }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    if (total !== row.expected_size) throw CommandError.validation({ file: "Uploaded bytes do not match the declared size." });
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
    const actualType = sniff(bytes);
    if (!actualType || actualType !== row.declared_content_type) throw CommandError.validation({ file: "The file content does not match the declared type." });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const key = row.object_key;
    if (row.state === "pending") {
      const uploaded = await runtime.client.storage.from(PRIVATE_ARTIFACT_BUCKET).upload(key, bytes, {
        contentType: actualType, cacheControl: "0", upsert: false
      });
      if (uploaded.error) throw CommandError.validation({ file: "Upload could not be completed. Start a new upload and retry." });
    }
    const completed = await runtime.client.rpc("complete_attachment_upload", {
      p_organization_id: organizationId, p_intent_id: intentId, p_actual_size: bytes.length,
      p_sha256: sha256, p_actual_content_type: actualType, p_request_id: generateRequestId()
    });
    if (completed.error || typeof completed.data !== "string") {
      if (row.state === "pending") await runtime.client.storage.from(PRIVATE_ARTIFACT_BUCKET).remove([key]);
      throw completed.error ?? new Error("Invalid upload completion response.");
    }
    return Response.json({ data: { attachmentId: parseUuid(completed.data), scanStatus: "pending" },
      meta: { request_id: generateRequestId(), replayed: row.state === "completed" } }, { status: row.state === "completed" ? 200 : 201, headers: noStore });
  } catch (error) { return failure(error); }
}
