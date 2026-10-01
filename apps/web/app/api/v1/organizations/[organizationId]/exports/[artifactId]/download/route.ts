import { artifactDownload } from "../../../../../../../../server/artifacts/http.ts";
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string; artifactId: string }> }) {
  const { organizationId, artifactId } = await context.params;
  return artifactDownload(organizationId, "exports", artifactId);
}
