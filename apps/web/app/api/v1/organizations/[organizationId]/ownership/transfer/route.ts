import { roleMutation } from "../../../../../../../server/roles/http.ts";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const params = await context.params;
  return roleMutation(request, params.organizationId, "transfer");
}
