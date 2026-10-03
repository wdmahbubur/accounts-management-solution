import { listOwnExportJobs, requestTrialBalanceExport } from "../../../../../../server/exports/http.ts";
import { requestReportExport } from "../../../../../../server/exports/report-http.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  try {
    const body = await request.clone().json() as { export_type?: unknown };
    if (body && ["profit_and_loss", "balance_sheet", "customer_statement", "vendor_statement"].includes(String(body.export_type))) {
      return requestReportExport(request, organizationId);
    }
  } catch { /* The handler returns the canonical invalid-body response. */ }
  return requestTrialBalanceExport(request, organizationId);
}

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return listOwnExportJobs(organizationId);
}
