import { roleGet } from "../../../../../../server/roles/http.ts";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return roleGet((await context.params).organizationId, "members");
}
