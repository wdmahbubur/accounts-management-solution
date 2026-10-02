import { createHash } from "node:crypto";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { assertMutationOrigin } from "../../../../../../../../server/auth/mutation-origin.ts";
import { resolveActorContext } from "../../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { executeOrganizationCommand } from "../../../../../../../../server/commands/execute.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../../../../../../../../server/company-context.ts";
import { saveContactCommand } from "../../../../../../../../server/contacts/service.ts";
import { saveItemCommand } from "../../../../../../../../server/catalog/service.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

const noStore = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const normalized = normalizeCommandError(error instanceof StaleCompanyContextError
    ? new CommandError({ code: "STALE_VERSION", message: "Company context changed. Reload before importing." }) : error);
  return Response.json(commandErrorBody(normalized, generateRequestId()), { status: normalized.status, headers: noStore });
}
export async function POST(request: Request, context: { params: Promise<{ organizationId: string; importId: string }> }) {
  try {
    assertMutationOrigin(request.headers);
    const params = await context.params; const organizationId = parseOrganizationId(params.organizationId); const importId = parseUuid(params.importId, "import_id");
    const runtime = await roleRuntime();
    assertFreshCompanySubmission({ expectedOrganizationId: organizationId, expectedNonce: request.headers.get("x-company-context"), current: runtime.current });
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("imports.run")) throw CommandError.forbidden();
    const loaded = await runtime.client.rpc("read_contact_import", { p_organization_id: organizationId, p_import_job_id: importId });
    let rawJob = Array.isArray(loaded.data) ? loaded.data[0] : null;
    if (!rawJob) {
      const itemLoad = await runtime.client.rpc("read_item_import", { p_organization_id: organizationId, p_import_job_id: importId });
      if (itemLoad.error || !Array.isArray(itemLoad.data) || itemLoad.data.length !== 1) throw itemLoad.error ?? CommandError.notFound();
      rawJob = itemLoad.data[0];
    }
    if (loaded.error && !rawJob) throw loaded.error;
    const job = rawJob as { id: string; type?: string; status: string; rows: Array<{ row_no: number; input_data: Record<string, unknown>; errors: string[]; status: string; contact_id?: string | null; result_id?: string | null }> };
    const type = job.type === "items" ? "items" : "contacts";
    if (!actor.capabilities.includes(type === "contacts" ? "contacts.write" : "catalog.write")) throw CommandError.forbidden();
    if (!["ready", "running"].includes(job.status)) throw CommandError.conflict("IMPORT_NOT_READY");
    if (job.rows.some((row) => row.status === "invalid")) throw CommandError.validation({ rows: "Fix or remove invalid rows before committing this import." });
    const pendingRows = job.rows.filter((row) => row.status === "valid");
    const batchRows = pendingRows.slice(0, 25);
    const outcomes: Array<{ row_no: number; status: "imported" | "failed"; record_id?: string; error?: string }> = [];
    for (const row of batchRows) {
      const key = createHash("sha256").update(`${organizationId}:${importId}:${row.row_no}`).digest("base64url");
      const command = await executeOrganizationCommand({ definition: type === "contacts" ? saveContactCommand(runtime.client, null) : saveItemCommand(runtime.client, null), organizationId,
        rawInput: type === "contacts" ? { expected_version: null, contact: row.input_data } : { expected_version: null, item: row.input_data },
        headers: { get(name: string) { return name.toLowerCase() === "idempotency-key" ? key : null; } }, dependencies: runtime.dependencies });
      if (command.status !== 200) {
        const error = (command.body as { error?: { message?: string } }).error;
        const message = error?.message ?? "The imported record could not be saved.";
        const recorded = await runtime.client.rpc(type === "contacts" ? "record_contact_import_row_error" : "record_item_import_row_error", { p_organization_id: organizationId,
          p_import_job_id: importId, p_row_no: row.row_no, p_message: message.slice(0, 240), p_request_id: generateRequestId() });
        if (recorded.error || recorded.data !== true) throw recorded.error ?? new Error("Import row error could not be saved.");
        outcomes.push({ row_no: row.row_no, status: "failed", error: message }); continue;
      }
      const saved = (command.body as { data: { id: string } }).data;
      const marked = await runtime.client.rpc(type === "contacts" ? "mark_contact_import_row" : "mark_item_import_row", {
        p_organization_id: organizationId, p_import_job_id: importId, p_row_no: row.row_no,
        ...(type === "contacts" ? { p_contact_id: parseUuid(saved.id) } : { p_item_id: parseUuid(saved.id) }), p_request_id: generateRequestId() });
      if (marked.error || marked.data !== true) throw marked.error ?? new Error("Import row progress could not be saved.");
      outcomes.push({ row_no: row.row_no, status: "imported", record_id: saved.id });
    }
    const failed = outcomes.filter((item) => item.status === "failed").length;
    const imported = job.rows.filter((row) => row.status === "imported").length + outcomes.filter((item) => item.status === "imported").length;
    const hasMore = failed === 0 && pendingRows.length > batchRows.length;
    return Response.json({ data: { import_job_id: importId, status: failed || hasMore ? "running" : "completed", outcomes,
      completed_count: imported, total_count: job.rows.length, has_more: hasMore },
      meta: { request_id: generateRequestId(), replayed: false } }, { status: failed ? 207 : 200, headers: noStore });
  } catch (error) { return failure(error); }
}
