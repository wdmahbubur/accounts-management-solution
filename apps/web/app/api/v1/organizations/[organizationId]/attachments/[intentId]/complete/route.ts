import { completeAttachmentUpload } from "../../../../../../../../server/artifacts/upload.ts";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; intentId: string }> }) {
  const { organizationId, intentId } = await context.params;
  return completeAttachmentUpload(request, organizationId, intentId);
}
