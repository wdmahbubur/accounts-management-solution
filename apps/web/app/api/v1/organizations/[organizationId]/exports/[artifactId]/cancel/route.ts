import { cancelQueuedTrialBalanceExport } from "../../../../../../../../server/exports/cancel-http.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; artifactId: string }> }) {
  const { organizationId, artifactId } = await context.params;
  return cancelQueuedTrialBalanceExport(request, organizationId, artifactId);
}
