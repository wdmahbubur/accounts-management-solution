import { createHash } from "node:crypto";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { assertMutationOrigin } from "../../../../../../../../server/auth/mutation-origin.ts";
import { resolveActorContext } from "../../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { executeOrganizationCommand } from "../../../../../../../../server/commands/execute.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../../../../../../../../server/company-context.ts";
import { saveContactCommand } from "../../../../../../../../server/contacts/service.ts";
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
    if (!actor.capabilities.includes("imports.run") || !actor.capabilities.includes("contacts.write")) throw CommandError.forbidden();
    const loaded = await runtime.client.rpc("read_contact_import", { p_organization_id: organizationId, p_import_job_id: importId });
    if (loaded.error || !Array.isArray(loaded.data) || loaded.data.length !== 1) throw loaded.error ?? CommandError.notFound();
    const job = loaded.data[0] as { id: string; status: string; rows: Array<{ row_no: number; input_data: Record<string, unknown>; errors: string[]; status: string; contact_id: string | null }> };
    if (!["ready", "running"].includes(job.status)) throw CommandError.conflict("IMPORT_NOT_READY");
    if (job.rows.some((row) => row.status === "invalid")) throw CommandError.validation({ rows: "Fix or remove invalid rows before committing this import." });
    const outcomes: Array<{ row_no: number; status: "imported" | "failed"; contact_id?: string; error?: string }> = [];
    for (const row of job.rows) {
      if (row.status === "imported" && row.contact_id) { outcomes.push({ row_no: row.row_no, status: "imported", contact_id: row.contact_id }); continue; }
      const key = createHash("sha256").update(`${organizationId}:${importId}:${row.row_no}`).digest("base64url");
      const command = await executeOrganizationCommand({ definition: saveContactCommand(runtime.client, null), organizationId,
        rawInput: { expected_version: null, contact: row.input_data },
        headers: { get(name: string) { return name.toLowerCase() === "idempotency-key" ? key : null; } }, dependencies: runtime.dependencies });
      if (command.status !== 200) {
        const error = (command.body as { error?: { message?: string } }).error;
        const message = error?.message ?? "Contact could not be saved.";
        const recorded = await runtime.client.rpc("record_contact_import_row_error", { p_organization_id: organizationId,
          p_import_job_id: importId, p_row_no: row.row_no, p_message: message.slice(0, 240), p_request_id: generateRequestId() });
        if (recorded.error || recorded.data !== true) throw recorded.error ?? new Error("Import row error could not be saved.");
        outcomes.push({ row_no: row.row_no, status: "failed", error: message }); continue;
      }
      const saved = (command.body as { data: { id: string } }).data;
      const marked = await runtime.client.rpc("mark_contact_import_row", { p_organization_id: organizationId,
        p_import_job_id: importId, p_row_no: row.row_no, p_contact_id: parseUuid(saved.id), p_request_id: generateRequestId() });
      if (marked.error || marked.data !== true) throw marked.error ?? new Error("Import row progress could not be saved.");
      outcomes.push({ row_no: row.row_no, status: "imported", contact_id: saved.id });
    }
    const failed = outcomes.filter((item) => item.status === "failed").length;
    return Response.json({ data: { import_job_id: importId, status: failed ? "running" : "completed", outcomes },
      meta: { request_id: generateRequestId(), replayed: false } }, { status: failed ? 207 : 200, headers: noStore });
  } catch (error) { return failure(error); }
}
