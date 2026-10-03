import { validateOwnImport } from "../../../../../../../../server/imports/http.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; jobId: string }> }) {
  const params = await context.params;
  return validateOwnImport(request, params.organizationId, params.jobId);
}
