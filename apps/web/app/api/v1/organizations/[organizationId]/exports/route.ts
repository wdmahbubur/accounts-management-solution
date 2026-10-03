import { listOwnExportJobs, requestTrialBalanceExport } from "../../../../../../server/exports/http.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return requestTrialBalanceExport(request, organizationId);
}

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return listOwnExportJobs(organizationId);
}
