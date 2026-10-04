import { attachmentUploadComplete } from "../../../../../../../../../server/artifacts/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; intentId: string }> }) {
  const { organizationId, intentId } = await context.params;
  return attachmentUploadComplete(organizationId, intentId, request);
}
