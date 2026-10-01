import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseUuid } from "@ams/contracts";
import { capability } from "@ams/permissions";
import type { ActorContext } from "../auth/types.ts";
import { CommandError } from "../commands/errors.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { generateRequestId } from "../commands/request-context.ts";
import { record } from "../roles/contracts.ts";
import { invitationInput, invitationRows, invitationToken, recipientInput,
  type InvitationInput, type InvitationOperation, type InvitationReceipt, type RecipientReceipt } from "./contracts.ts";
import { createInvitationSecret } from "./tokens.ts";
type RpcClient = Pick<SupabaseClient, "rpc">;
export function invitationDatabaseError(error: { code?: string; message?: string }): CommandError {
  if (error.code === "28000") return CommandError.unauthenticated();
  if (error.code === "42501") return new CommandError({ code: "FORBIDDEN", message: "Use the intended verified account and a recent sign-in with sufficient permissions." });
  if (error.code === "P0002") return new CommandError({ code: "NOT_FOUND", message: "Invitation or artifact unavailable. It may have expired or access may have changed." });
  if (error.code === "22023") return CommandError.validation({ invitation: "Check the email, role and invitation selection." });
  if (error.code === "23505") return new CommandError({ code: "STALE_VERSION", message: "This recipient already has access or a pending invitation. Refresh the list." });
  if (error.code === "P0429") return new CommandError({ code: "RATE_LIMITED", message: "Wait at least 60 seconds before resending. Company invitation limits also apply." });
  return new CommandError({ code: "INTERNAL_ERROR" });
}
export async function listInvitations(client: RpcClient, actor: ActorContext) {
  if (!actor.capabilities.includes("users.read")) throw CommandError.forbidden();
  const result = await client.rpc("list_company_invitations", { p_organization_id: actor.organizationId });
  if (result.error) throw invitationDatabaseError(result.error);
  return invitationRows(result.data);
}
export function invitationCommand(operation: InvitationOperation, client: RpcClient,
  secrets: typeof createInvitationSecret = createInvitationSecret): OrganizationCommandDefinition<InvitationInput, InvitationReceipt> {
  return { operation: `invitations.${operation}`, capability: capability("users.manage"), idempotency: "optional",
    validate: (raw) => invitationInput(operation, raw),
    async execute(context, input) {
      const id = input.invitationId ?? parseUuid(randomUUID());
      const secret = operation === "revoke" ? null : secrets(context.actor.organizationId, id);
      const common = { p_organization_id: context.actor.organizationId, p_invitation_id: id, p_request_id: context.requestId };
      const delivery = secret ? { p_token_hash: secret.tokenHash, p_delivery: secret.delivery } : {};
      const result = await client.rpc(operation === "create" ? "issue_company_invitation"
        : operation === "resend" ? "resend_company_invitation" : "revoke_company_invitation",
        { ...common, ...delivery, ...(operation === "create" ? { p_email: input.email, p_role_id: input.roleId } : {}) });
      if (result.error) throw invitationDatabaseError(result.error);
      return { invitationId: id, message: operation === "revoke" ? "Invitation revoked."
        : "Invitation created and delivery queued. Share this one-time link with the intended recipient.",
        ...(secret ? { invitationPath: secret.invitationPath } : {}) };
    } };
}
export async function inspectInvitation(client: RpcClient, raw: unknown) {
  const result = await client.rpc("inspect_company_invitation", { p_token: invitationToken(raw) });
  if (result.error) throw invitationDatabaseError(result.error);
  if (!Array.isArray(result.data) || result.data.length !== 1) throw CommandError.notFound();
  const row = record(result.data[0]);
  if (typeof row.organization_name !== "string" || typeof row.role_name !== "string" || typeof row.expires_at !== "string") throw new Error("Invalid invitation inspection.");
  return { organizationId: parseUuid(row.organization_id), organizationName: row.organization_name, roleName: row.role_name, expiresAt: row.expires_at };
}
export async function respondToInvitation(client: Pick<SupabaseClient, "rpc" | "auth">, raw: unknown): Promise<RecipientReceipt> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw CommandError.unauthenticated();
  const input = recipientInput(raw);
  const result = await client.rpc("respond_company_invitation", {
    p_token: input.token, p_decision: input.decision, p_request_id: generateRequestId()
  });
  if (result.error) throw invitationDatabaseError(result.error);
  if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error("Invalid invitation response.");
  const row = record(result.data[0]);
  if (row.invitation_status !== "accepted" && row.invitation_status !== "rejected") throw new Error("Invalid invitation status.");
  return { organizationId: parseUuid(row.organization_id), status: row.invitation_status,
    message: row.invitation_status === "accepted" ? "Invitation accepted. Open the company from your company list." : "Invitation rejected." };
}
