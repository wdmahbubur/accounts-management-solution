import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, CommandError, normalizeCommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { readCreditNoteOptions, type CreditNoteType } from "../../../../../../../server/documents/credit-notes.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const organizationId = parseOrganizationId((await context.params).organizationId);
    const query = new URL(request.url).searchParams;
    const allowed = ["document_type", "accounting_date", "party_id", "original_document_id", "search"];
    if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)) {
      throw CommandError.validation({ query: "Use one value per supported credit source filter." });
    }
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const data = await readCreditNoteOptions(runtime.client, actor, {
      documentType: query.get("document_type") as CreditNoteType, accountingDate: query.get("accounting_date") ?? "",
      partyId: query.get("party_id"), originalDocumentId: query.get("original_document_id"), search: query.get("search")
    });
    return Response.json({ data, meta: { request_id: requestId, replayed: false } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
