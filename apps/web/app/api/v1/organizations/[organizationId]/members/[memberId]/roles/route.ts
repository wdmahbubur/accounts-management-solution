import { roleMutation } from "../../../../../../../../server/roles/http.ts";

export const dynamic = "force-dynamic";
export async function PUT(request: Request, context: { params: Promise<{ organizationId: string; memberId: string }> }) {
  const params = await context.params;
  return roleMutation(request, params.organizationId, "assign", { member_id: params.memberId });
}
