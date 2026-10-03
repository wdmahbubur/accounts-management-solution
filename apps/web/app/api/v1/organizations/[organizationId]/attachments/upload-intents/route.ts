import { attachmentUploadIntent } from "../../../../../../../server/artifacts/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return attachmentUploadIntent(organizationId, request);
}
