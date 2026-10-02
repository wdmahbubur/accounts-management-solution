import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { assertMutationOrigin } from "../../../../../../server/auth/mutation-origin.ts";
import { createSupabaseIdentityVerifier } from "../../../../../../server/auth/supabase-identity.ts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../../../../../../server/company-context.ts";
import { parseContactCsv, MAX_CONTACT_IMPORT_BYTES } from "../../../../../../server/imports/contact-csv.ts";
import { PRIVATE_ARTIFACT_BUCKET } from "../../../../../../server/artifacts/download.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";

const noStore = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const normalized = normalizeCommandError(error instanceof StaleCompanyContextError
    ? new CommandError({ code: "STALE_VERSION", message: "Company context changed. Reload before importing." }) : error);
  return Response.json(commandErrorBody(normalized, generateRequestId()), { status: normalized.status, headers: noStore });
}
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const organizationId = parseOrganizationId((await context.params).organizationId); const runtime = await roleRuntime();
    const result = await runtime.client.rpc("read_contact_import", { p_organization_id: organizationId, p_import_job_id: null });
    if (result.error) throw result.error;
    return Response.json({ data: result.data ?? [], meta: { request_id: generateRequestId(), replayed: false } }, { headers: noStore });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    assertMutationOrigin(request.headers);
    const organizationId = parseOrganizationId((await context.params).organizationId); const runtime = await roleRuntime();
    assertFreshCompanySubmission({ expectedOrganizationId: organizationId, expectedNonce: request.headers.get("x-company-context"), current: runtime.current });
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("imports.run")) throw CommandError.forbidden();
    if (!await createSupabaseIdentityVerifier(runtime.client).verifyIdentity()) throw CommandError.unauthenticated();
    const declared = request.headers.get("content-length");
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" ||
      (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_CONTACT_IMPORT_BYTES + 65536))) {
      throw CommandError.validation({ file: "Send a JSON CSV upload under 5 MiB." });
    }
    if (!request.body) throw CommandError.validation({ file: "CSV contents are missing." });
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength;
      if (total > MAX_CONTACT_IMPORT_BYTES + 65536) { await reader.cancel(); throw CommandError.validation({ file: "CSV exceeds the 5 MiB limit." }); }
      chunks.push(part.value); } } finally { reader.releaseLock(); }
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8")) as Record<string, unknown>; }
    catch { throw CommandError.validation({ body: "Expected valid JSON containing a CSV filename and contents." }); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((key) => !["filename", "csv", "mapping"].includes(key)) ||
      typeof raw.filename !== "string" || typeof raw.csv !== "string") throw CommandError.validation({ body: "Provide a CSV filename and contents." });
    const filename = raw.filename.trim();
    if (!filename || filename.length > 180 || /[\x00-\x1f\x7f/\\]/.test(filename) || !filename.toLowerCase().endsWith(".csv")) {
      throw CommandError.validation({ filename: "Use a .csv filename without path separators or control characters." });
    }
    let parsed;
    try { parsed = parseContactCsv(raw.csv, raw.mapping); } catch (error) { throw CommandError.validation({ file: error instanceof Error ? error.message : "CSV could not be read." }); }
    const requestId = generateRequestId();
    const created = await runtime.client.rpc("create_contact_import", { p_organization_id: organizationId, p_filename: filename,
      p_size: parsed.bytes.length, p_sha256: parsed.sha256, p_rows: parsed.rows, p_mapping: parsed.mapping, p_request_id: requestId });
    if (created.error || !Array.isArray(created.data) || created.data.length !== 1) throw created.error ?? new Error("Import could not be staged.");
    const row = created.data[0] as { import_job_id?: unknown; object_key?: unknown };
    const jobId = parseUuid(row.import_job_id, "import_job_id"); const key = `${organizationId}/imports/${parseUuid(String(row.object_key).split("/").at(-1), "intent_id")}`;
    if (row.object_key !== key) throw new Error("Import storage scope is invalid.");
    const upload = await runtime.client.storage.from(PRIVATE_ARTIFACT_BUCKET).upload(key, parsed.bytes, { contentType: "text/csv; charset=utf-8", cacheControl: "0", upsert: false });
    // A prior request may have stored the immutable object and failed before the
    // database transition. Completion verifies the pending intent and object.
    const completed = await runtime.client.rpc("complete_contact_import_upload", { p_organization_id: organizationId,
      p_import_job_id: jobId, p_sha256: parsed.sha256, p_request_id: generateRequestId() });
    if (completed.error || completed.data !== true) {
      if (!upload.error) await runtime.client.storage.from(PRIVATE_ARTIFACT_BUCKET).remove([key]);
      throw completed.error ?? new Error(upload.error ? "Private CSV storage failed. Retry the same file to resume the upload." : "Import upload could not be completed.");
    }
    return Response.json({ data: { id: jobId, status: "ready", row_count: parsed.rows.length,
      valid_count: parsed.rows.filter((item) => item.status === "valid").length,
      invalid_count: parsed.rows.filter((item) => item.status === "invalid").length },
      meta: { request_id: requestId, replayed: false } }, { status: 201, headers: noStore });
  } catch (error) { return failure(error); }
}
