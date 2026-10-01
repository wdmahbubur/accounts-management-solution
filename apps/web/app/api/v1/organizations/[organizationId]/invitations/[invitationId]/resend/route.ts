import { invitationMutation } from "../../../../../../../../server/invitations/http.ts";
type Context = { params: Promise<{ organizationId: string; invitationId: string }> };
export async function POST(request: Request, context: Context) {
  const { organizationId, invitationId } = await context.params;
  return invitationMutation(request, organizationId, "resend", invitationId);
}
