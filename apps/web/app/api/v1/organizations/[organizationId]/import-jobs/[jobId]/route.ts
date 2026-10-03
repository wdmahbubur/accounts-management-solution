import { readOwnImport } from "../../../../../../../server/imports/http.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string; jobId: string }> }) {
  const params = await context.params;
  return readOwnImport(params.organizationId, params.jobId);
}
