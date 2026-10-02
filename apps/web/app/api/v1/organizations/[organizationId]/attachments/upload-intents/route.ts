import { createAttachmentUploadIntent } from "../../../../../../../server/artifacts/upload.ts";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return createAttachmentUploadIntent(request, organizationId);
}
