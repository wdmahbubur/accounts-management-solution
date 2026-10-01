import { invitationGet, invitationMutation } from "../../../../../../server/invitations/http.ts";
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(_request: Request, context: Context) { return invitationGet((await context.params).organizationId); }
export async function POST(request: Request, context: Context) { return invitationMutation(request, (await context.params).organizationId, "create"); }
