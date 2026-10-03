import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseMutationHeaders, parseOrganizationId, parseUuid } from "@ams/contracts";
import { assertMutationOrigin } from "../auth/mutation-origin.ts";
import { resolveActorContext } from "../auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../commands/errors.ts";
import { executeOrganizationCommand } from "../commands/execute.ts";
import { generateRequestId, hashCanonicalRequest } from "../commands/request-context.ts";
import { saveItemCommand } from "../catalog/service.ts";
import { saveContactCommand } from "../contacts/service.ts";
import { parseMasterDataCsv, type ImportType, type StagedCsvRow } from "./csv.ts";
import { roleRuntime } from "../roles/runtime.ts";
import { record } from "../roles/contracts.ts";
import { deletePrivateImportObject, readPrivateObject, writePrivateImportObject } from "../storage/private.ts";

const noStore = { "Cache-Control": "private, no-store" };
const maxUploadBytes = 2 * 1024 * 1024;
const typeCapability = (type: ImportType) => type === "contacts" ? "contacts.write" : "catalog.write";
const rowKey = () => randomBytes(32).toString("base64url");

function fail(error: unknown, requestId = generateRequestId()) {
  const safe = normalizeCommandError(error);
  return Response.json(commandErrorBody(safe, requestId), { status: safe.status, headers: noStore });
}

function rpcError(error: { code?: string } | null, fallback: string): never {
  if (error?.code === "28000") throw CommandError.unauthenticated();
  if (error?.code === "42501") throw CommandError.forbidden();
  if (error?.code === "P0002") throw CommandError.notFound();
  if (error?.code === "23505") throw CommandError.conflict("DUPLICATE_IMPORT");
  if (error?.code === "40001") throw CommandError.conflict("STALE_VERSION");
  if (error?.code === "22023") throw CommandError.validation({ import: "The import data or current job state is invalid." });
  throw new Error(fallback);
}

function typeValue(value: FormDataEntryValue | null): ImportType {
  if (value !== "contacts" && value !== "items") throw CommandError.validation({ import_type: "Choose contacts or service items." });
  return value;
}

function safeFilename(value: string): string {
  const name = value.normalize("NFC").trim();
  if (name.length < 1 || name.length > 180 || !name.toLowerCase().endsWith(".csv") || /[/\\\u0000-\u001f\u007f]/.test(name))
    throw CommandError.validation({ file: "Choose a CSV file with a safe filename." });
  return name;
}

function parseStagedRows(value: unknown): StagedCsvRow[] {
  if (!Array.isArray(value)) throw new Error("Import row response is invalid.");
  return value.map(entry => {
    const row = record(entry);
    if (!Number.isSafeInteger(row.row_no) || typeof row.input_data !== "object" || row.input_data === null || Array.isArray(row.input_data))
      throw new Error("Import row response is invalid.");
    return { row_no: Number(row.row_no), input_data: row.input_data as Record<string, unknown> };
  });
}

export async function stageMasterDataImport(request: Request, rawOrganizationId: string) {
  const fallbackRequestId = generateRequestId();
  try {
    assertMutationOrigin(request.headers);
    const organizationId = parseOrganizationId(rawOrganizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("imports.run")) throw CommandError.forbidden();
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > maxUploadBytes + 64 * 1024) throw CommandError.validation({ file: "CSV files must be 2 MiB or smaller." });
    let form: FormData;
    try { form = await request.formData(); } catch { throw CommandError.validation({ file: "Import form is invalid." }); }
    const type = typeValue(form.get("import_type"));
    if (!actor.capabilities.includes(typeCapability(type))) throw CommandError.forbidden();
    const file = form.get("file");
    if (!(file instanceof File)) throw CommandError.validation({ file: "Choose a CSV file." });
    const filename = safeFilename(file.name);
    if (file.size < 1 || file.size > maxUploadBytes) throw CommandError.validation({ file: "CSV files must be 1 byte to 2 MiB." });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) throw CommandError.validation({ file: "File size changed during upload." });
    const rows = parseMasterDataCsv(bytes, type);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const parsedHeaders = parseMutationHeaders(request.headers, { idempotency: "required" });
    const requestId = parsedHeaders.requestId ?? fallbackRequestId;
    const idempotencyKey = parsedHeaders.idempotencyKey;
    if (!idempotencyKey) throw CommandError.validation({ "Idempotency-Key": "An idempotency key is required." });
    const payload = { import_type: type, file_sha256: sha256, source_name: filename, row_count: rows.length };
    const requestHash = hashCanonicalRequest({ operation: "imports.stage", organizationId, payload });
    const jobId = randomUUID();
    const objectKey = `${organizationId}/imports/${jobId}`;
    const created = await runtime.client.rpc("create_staged_import", {
      p_organization_id: organizationId, p_job_id: jobId, p_import_type: type, p_file_sha256: sha256,
      p_file_object_key: objectKey, p_source_name: filename, p_row_count: rows.length,
      p_request_id: requestId, p_idempotency_key: idempotencyKey, p_request_hash: requestHash
    });
    if (created.error) rpcError(created.error, "Import job could not be created.");
    const job = record(created.data);
    if (typeof job.id !== "string" || typeof job.status !== "string") throw new Error("Invalid staged import response.");
    if (["validating", "ready", "running", "completed"].includes(job.status)) {
      // A crash can occur after the database has staged the rows but before the
      // private source bytes are removed. They are no longer needed once the
      // job leaves the uploaded state.
      await deletePrivateImportObject(`${organizationId}/imports/${job.id}`);
      return Response.json({ data: { id: job.id, import_type: type, status: job.status, row_count: job.row_count, source_name: job.source_name }, meta: { request_id: requestId, replayed: true } }, { status: 200, headers: noStore });
    }
    if (typeof job.object_key !== "string" || job.object_key !== `${organizationId}/imports/${job.id}`) throw new Error("Invalid staged import object path.");
    const uploaded = await writePrivateImportObject(job.object_key, bytes);
    if (!uploaded) {
      const existing = await readPrivateObject(job.object_key);
      if (!existing || createHash("sha256").update(existing).digest("hex") !== sha256)
        throw new Error("Private import storage is unavailable. Retry this upload with the same idempotency key.");
    }
    const staged = rows.map(row => ({ ...row, command_idempotency_key: rowKey() }));
    const saved = await runtime.client.rpc("stage_import_rows", { p_organization_id: organizationId, p_job_id: job.id, p_rows: staged });
    if (saved.error) rpcError(saved.error, "Import rows could not be staged.");
    await deletePrivateImportObject(job.object_key);
    return Response.json({ data: { id: job.id, import_type: type, status: "validating", row_count: rows.length, source_name: filename }, meta: { request_id: requestId, replayed: job.replayed === true } }, { status: 202, headers: noStore });
  } catch (error) { return fail(error, fallbackRequestId); }
}

export async function listOwnImports(rawOrganizationId: string) {
  const requestId = generateRequestId();
  try {
    const organizationId = parseOrganizationId(rawOrganizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("imports.read")) throw CommandError.forbidden();
    const result = await runtime.client.rpc("list_own_import_jobs", { p_organization_id: organizationId, p_limit: 50 });
    if (result.error || !Array.isArray(result.data)) rpcError(result.error, "Import jobs could not be loaded.");
    return Response.json({ data: result.data, meta: { request_id: requestId } }, { headers: noStore });
  } catch (error) { return fail(error, requestId); }
}

export async function readOwnImport(rawOrganizationId: string, rawJobId: string) {
  const requestId = generateRequestId();
  try {
    const organizationId = parseOrganizationId(rawOrganizationId); const jobId = parseUuid(rawJobId, "job_id");
    const runtime = await roleRuntime(); const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("imports.read")) throw CommandError.forbidden();
    const result = await runtime.client.rpc("read_own_import_job", { p_organization_id: organizationId, p_job_id: jobId });
    if (result.error) rpcError(result.error, "Import job could not be loaded.");
    return Response.json({ data: record(result.data), meta: { request_id: requestId } }, { headers: noStore });
  } catch (error) { return fail(error, requestId); }
}

export async function validateOwnImport(request: Request, rawOrganizationId: string, rawJobId: string) {
  const requestId = generateRequestId();
  try {
    assertMutationOrigin(request.headers);
    const organizationId = parseOrganizationId(rawOrganizationId); const jobId = parseUuid(rawJobId, "job_id");
    const runtime = await roleRuntime(); const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("imports.run")) throw CommandError.forbidden();
    const jobResult = await runtime.client.rpc("read_own_import_job", { p_organization_id: organizationId, p_job_id: jobId });
    if (jobResult.error) rpcError(jobResult.error, "Import job could not be loaded.");
    const job = record(jobResult.data); if (job.import_type !== "contacts" && job.import_type !== "items") throw CommandError.notFound();
    if (!actor.capabilities.includes(typeCapability(job.import_type))) throw CommandError.forbidden();
    const rowsResult = await runtime.client.rpc("read_import_validation_rows", { p_organization_id: organizationId, p_job_id: jobId });
    if (rowsResult.error) rpcError(rowsResult.error, "Import rows could not be loaded for validation.");
    const rows = parseStagedRows(rowsResult.data);
    const definition = job.import_type === "contacts" ? saveContactCommand(runtime.client, null) : saveItemCommand(runtime.client, null);
    const results = rows.map(row => {
      try {
        const validated = definition.validate(job.import_type === "contacts"
          ? { expected_version: null, contact: row.input_data }
          : { expected_version: null, item: row.input_data }) as Record<string, unknown>;
        const normalized = (validated.contact ?? validated.payload) as Record<string, unknown>;
        return { row_no: row.row_no, input_data: normalized, errors: [] };
      } catch (error) {
        const safe = normalizeCommandError(error);
        const errors = Object.entries(safe.fields ?? { row: safe.message }).map(([field, message]) => ({ field, message }));
        return { row_no: row.row_no, input_data: row.input_data, errors };
      }
    });
    const recorded = await runtime.client.rpc("record_import_validation", { p_organization_id: organizationId, p_job_id: jobId, p_results: results });
    if (recorded.error) rpcError(recorded.error, "Import validation could not be saved.");
    return Response.json({ data: recorded.data, meta: { request_id: requestId } }, { headers: noStore });
  } catch (error) { return fail(error, requestId); }
}

export async function commitOwnImport(request: Request, rawOrganizationId: string, rawJobId: string) {
  const requestId = generateRequestId();
  try {
    assertMutationOrigin(request.headers);
    const organizationId = parseOrganizationId(rawOrganizationId); const jobId = parseUuid(rawJobId, "job_id");
    const runtime = await roleRuntime(); const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("imports.run")) throw CommandError.forbidden();
    const infoResult = await runtime.client.rpc("read_own_import_job", { p_organization_id: organizationId, p_job_id: jobId });
    if (infoResult.error) rpcError(infoResult.error, "Import job could not be loaded.");
    const job = record(infoResult.data); if (job.import_type !== "contacts" && job.import_type !== "items") throw CommandError.notFound();
    if (!actor.capabilities.includes(typeCapability(job.import_type))) throw CommandError.forbidden();
    const claim = await runtime.client.rpc("claim_import_commit", { p_organization_id: organizationId, p_job_id: jobId });
    if (claim.error) rpcError(claim.error, "Import commit could not be started.");
    const claimed = record(claim.data);
    if (claimed.status === "completed") return Response.json({ data: claimed, meta: { request_id: requestId } }, { headers: noStore });
    if (typeof claimed.lease_token !== "string") throw new Error("Import lease response is invalid.");
    const leaseToken = claimed.lease_token;
    const batch = await runtime.client.rpc("read_import_commit_rows", { p_organization_id: organizationId, p_job_id: jobId, p_lease_token: leaseToken, p_limit: 25 });
    if (batch.error || !Array.isArray(batch.data)) rpcError(batch.error, "Import rows could not be loaded for commit.");
    const rawRows = batch.data.map((value: unknown) => {
      const row = record(value); return { row_no: row.row_no, input_data: row.input_data, command_idempotency_key: row.command_idempotency_key };
    });
    const rows = parseStagedRows(rawRows);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!; const raw = record(rawRows[index]);
      const key = raw.command_idempotency_key;
      if (typeof key !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error("Import row idempotency key is invalid.");
      const headers = new Headers({ "Idempotency-Key": key, "X-Request-Id": `import-${jobId}-${row.row_no}-${requestId}` });
      const command = job.import_type === "contacts"
        ? await executeOrganizationCommand({ definition: saveContactCommand(runtime.client, null), organizationId,
          rawInput: { expected_version: null, contact: row.input_data }, headers, dependencies: runtime.dependencies })
        : await executeOrganizationCommand({ definition: saveItemCommand(runtime.client, null), organizationId,
          rawInput: { expected_version: null, item: row.input_data }, headers, dependencies: runtime.dependencies });
      const body = record(command.body);
      let rowStatus: "imported" | "invalid" | "valid"; let errors: unknown[] = []; let resultId: string | null = null;
      if (command.status < 400) {
        const data = record(body.data);
        if (typeof data.id !== "string") throw new Error("Typed import command did not return a record id.");
        rowStatus = "imported"; resultId = parseUuid(data.id);
      } else {
        const errorBody = record(body.error); const code = typeof errorBody.code === "string" ? errorBody.code : "INTERNAL_ERROR";
        if (code === "UNAUTHENTICATED") throw CommandError.unauthenticated();
        if (code === "FORBIDDEN") throw CommandError.forbidden();
        if (code === "NOT_FOUND") throw CommandError.notFound();
        rowStatus = command.status >= 500 ? "valid" : "invalid";
        const message = typeof errorBody.message === "string" ? errorBody.message : "This row could not be imported.";
        const fields = errorBody.fields && typeof errorBody.fields === "object" ? errorBody.fields as Record<string, unknown> : {};
        errors = Object.entries(fields).map(([field, detail]) => ({ field, message: typeof detail === "string" ? detail : message }));
        if (!errors.length) errors = [{ field: "row", code, message }];
      }
      const saved = await runtime.client.rpc("record_import_row_result", { p_organization_id: organizationId, p_job_id: jobId,
        p_lease_token: leaseToken, p_row_no: row.row_no, p_status: rowStatus, p_errors: errors, p_result_id: resultId });
      if (saved.error) rpcError(saved.error, "Import row progress could not be saved.");
    }
    const finished = await runtime.client.rpc("finish_import_commit", { p_organization_id: organizationId, p_job_id: jobId, p_lease_token: leaseToken });
    if (finished.error) rpcError(finished.error, "Import progress could not be finalized.");
    return Response.json({ data: finished.data, meta: { request_id: requestId, processed: rows.length } }, { headers: noStore });
  } catch (error) { return fail(error, requestId); }
}
