import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { getIssuedInvoicePdf } from "../../../../../../../../server/documents/invoice-pdf-storage.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string; documentId: string }> }) {
  const requestId = generateRequestId();
  const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  try {
    const { organizationId: rawOrganizationId, documentId } = await context.params;
    const organizationId = parseOrganizationId(rawOrganizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const pdf = await getIssuedInvoicePdf(runtime.client, actor, documentId);
    return new Response(pdf.bytes, { headers: { ...headers, "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.filename}"` } });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers });
  }
}
