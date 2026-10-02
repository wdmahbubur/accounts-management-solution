import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { createHash } from "node:crypto";
import { assertMutationOrigin } from "../../../../../../server/auth/mutation-origin.ts";
import { createSupabaseIdentityVerifier } from "../../../../../../server/auth/supabase-identity.ts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../../../../../../server/company-context.ts";
import { parseContactCsv, parseItemCsv, parseFinancialDraftCsv, MAX_CONTACT_IMPORT_BYTES } from "../../../../../../server/imports/contact-csv.ts";
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
    const items = await runtime.client.rpc("read_item_import", { p_organization_id: organizationId, p_import_job_id: null });
    if (items.error) throw items.error;
    const drafts = await runtime.client.rpc("read_financial_draft_import", { p_organization_id: organizationId, p_import_job_id: null });
    if (drafts.error) throw drafts.error;
    const jobs = [...(Array.isArray(result.data) ? result.data : []), ...(Array.isArray(items.data) ? items.data : []), ...(Array.isArray(drafts.data) ? drafts.data : [])];
    jobs.sort((left, right) => Date.parse(String((right as Record<string, unknown>).created_at)) - Date.parse(String((left as Record<string, unknown>).created_at)));
    return Response.json({ data: jobs, meta: { request_id: generateRequestId(), replayed: false } }, { headers: noStore });
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
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((key) => !["filename", "csv", "mapping", "type"].includes(key)) ||
      typeof raw.filename !== "string" || typeof raw.csv !== "string" || !["contacts", "items", "invoice_drafts", "bill_drafts"].includes(String(raw.type))) {
      throw CommandError.validation({ body: "Provide a supported import type, CSV filename and contents." });
    }
    const requiredCapability = raw.type === "contacts" ? "contacts.write" : raw.type === "items" ? "catalog.write" :
      raw.type === "invoice_drafts" ? "sales.write" : "purchases.write";
    if (!actor.capabilities.includes(requiredCapability) || (raw.type === "invoice_drafts" || raw.type === "bill_drafts") && !actor.capabilities.includes("documents.read")) {
      throw CommandError.forbidden();
    }
    const filename = raw.filename.trim();
    if (!filename || filename.length > 180 || /[\x00-\x1f\x7f/\\]/.test(filename) || !filename.toLowerCase().endsWith(".csv")) {
      throw CommandError.validation({ filename: "Use a .csv filename without path separators or control characters." });
    }
    let parsed;
    try { parsed = raw.type === "contacts" ? parseContactCsv(raw.csv, raw.mapping) : raw.type === "items" ? parseItemCsv(raw.csv, raw.mapping) :
      parseFinancialDraftCsv(raw.csv, raw.type === "invoice_drafts" ? "invoice" : "bill", raw.mapping); }
    catch (error) { throw CommandError.validation({ file: error instanceof Error ? error.message : "CSV could not be read." }); }
    const requestId = generateRequestId();
    const common = { p_organization_id: organizationId, p_filename: filename, p_size: parsed.bytes.length,
      p_sha256: parsed.sha256, p_rows: parsed.rows, p_mapping: parsed.mapping, p_request_id: requestId };
    const created = raw.type === "contacts" ? await runtime.client.rpc("create_contact_import", common) : raw.type === "items" ?
      await runtime.client.rpc("create_item_import", common) : await runtime.client.rpc("create_financial_draft_import", {
        ...common, p_document_type: raw.type === "invoice_drafts" ? "invoice" : "bill" });
    if (created.error || !Array.isArray(created.data) || created.data.length !== 1) throw created.error ?? new Error("Import could not be staged.");
    const row = created.data[0] as { import_job_id?: unknown; object_key?: unknown };
    const jobId = parseUuid(row.import_job_id, "import_job_id"); const key = `${organizationId}/imports/${parseUuid(String(row.object_key).split("/").at(-1), "intent_id")}`;
    if (row.object_key !== key) throw new Error("Import storage scope is invalid.");
    const upload = await runtime.client.storage.from(PRIVATE_ARTIFACT_BUCKET).upload(key, parsed.bytes, { contentType: "text/csv; charset=utf-8", cacheControl: "0", upsert: false });
    const stored = await runtime.client.storage.from(PRIVATE_ARTIFACT_BUCKET).download(key);
    if (stored.error || !stored.data || stored.data.size !== parsed.bytes.length) {
      if (!upload.error) await runtime.client.storage.from(PRIVATE_ARTIFACT_BUCKET).remove([key]);
      throw CommandError.validation({ file: "Stored CSV bytes do not match the import source. Retry the same file." });
    }
    const storedBytes = Buffer.from(await stored.data.arrayBuffer());
    if (createHash("sha256").update(storedBytes).digest("hex") !== parsed.sha256) {
      await runtime.client.storage.from(PRIVATE_ARTIFACT_BUCKET).remove([key]);
      throw CommandError.validation({ file: "Stored CSV digest does not match the import source. Retry the same file." });
    }
    // A prior request may have stored the immutable object and failed before the
    // database transition. Completion verifies the pending intent and object.
    const completed = await runtime.client.rpc("complete_contact_import_upload", { p_organization_id: organizationId,
      p_import_job_id: jobId, p_sha256: parsed.sha256, p_request_id: generateRequestId() });
    if (completed.error || completed.data !== true) {
      if (!upload.error) await runtime.client.storage.from(PRIVATE_ARTIFACT_BUCKET).remove([key]);
      throw completed.error ?? new Error(upload.error ? "Private CSV storage failed. Retry the same file to resume the upload." : "Import upload could not be completed.");
    }
    return Response.json({ data: { id: jobId, type: raw.type, status: "ready", row_count: parsed.rows.length,
      valid_count: parsed.rows.filter((item) => item.status === "valid").length,
      invalid_count: parsed.rows.filter((item) => item.status === "invalid").length },
      meta: { request_id: requestId, replayed: false } }, { status: 201, headers: noStore });
  } catch (error) { return failure(error); }
}
