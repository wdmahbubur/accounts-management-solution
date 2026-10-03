import { parseMutationHeaders, parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError, CommandError } from "../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { getIssuedInvoicePdf } from "../../../../../../../../server/documents/invoice-pdf-storage.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; documentId: string }> }) {
  const requestId = generateRequestId();
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const params = await context.params;
    const organizationId = parseOrganizationId(params.organizationId);
    const documentId = parseUuid(params.documentId, "document_id");
    const mutation = parseMutationHeaders(request.headers, { idempotency: "required" });
    if (!mutation.idempotencyKey) throw CommandError.validation({ "Idempotency-Key": "A unique request key is required." });
    const requestKey = parseUuid(mutation.idempotencyKey, "Idempotency-Key");
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("sales.write")) throw CommandError.forbidden();
    const pdf = await getIssuedInvoicePdf(runtime.client, actor, documentId);
    const result = await runtime.client.rpc("request_invoice_email_delivery", {
      p_organization_id: organizationId,
      p_document_id: documentId,
      p_pdf_version_id: pdf.pdfId,
      p_request_id: requestKey
    });
    if (result.error) {
      if (result.error.code === "28000") throw CommandError.unauthenticated();
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "P0002") throw CommandError.notFound();
      if (result.error.code === "22023") throw CommandError.validation({ invoice: "The issued invoice has no deliverable customer email." });
      if (result.error.code === "40001") throw CommandError.conflict("STALE_VERSION");
      if (result.error.code === "23505") throw CommandError.conflict("IDEMPOTENCY_CONFLICT");
      throw new Error("Invoice email could not be queued.");
    }
    const deliveryStatus = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>).status : null;
    return Response.json({ data: { request_recorded: true, status: deliveryStatus }, meta: { request_id: mutation.requestId ?? requestId, replayed: false } }, { headers });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers });
  }
}
