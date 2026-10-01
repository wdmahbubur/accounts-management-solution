import type { SupabaseClient } from "@supabase/supabase-js";
import { capability } from "@ams/permissions";
import { parseUuid } from "@ams/contracts";
import type { ActorContext } from "../auth/types.ts";
import { CommandError } from "../commands/errors.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { parseMembers, parseRoles, validateRoleInput,
  type RoleInput, type RoleOperation, type RoleReceipt } from "./contracts.ts";

type RpcClient = Pick<SupabaseClient, "rpc">;
export function roleDatabaseError(error: { code?: string; message?: string }): CommandError {
  if (error.code === "28000") return CommandError.unauthenticated();
  if (error.code === "42501") return new CommandError({ code: "FORBIDDEN",
    message: error.message === "recent authentication required"
      ? "Sign in again before changing roles or ownership." : undefined });
  if (error.code === "22023") return CommandError.validation({
    role: "The role, member or capability selection is invalid. Refresh and check your inputs."
  });
  if (error.code === "23505" || error.code === "23514") return new CommandError({
    code: "STALE_VERSION", message: error.code === "23505"
      ? "This role name is already used. Choose a different name."
      : "At least one active Owner must remain. Transfer ownership before removing access."
  });
  return new CommandError({ code: "INTERNAL_ERROR" });
}
export async function readRoleManagement(client: RpcClient, actor: ActorContext) {
  if (!actor.capabilities.includes("users.read")) throw CommandError.forbidden();
  const args = { p_organization_id: actor.organizationId };
  // Each RPC also rechecks live membership/capabilities, including concurrent revocation.
  const [roles, members] = await Promise.all([
    client.rpc("list_roles_for_management", args),
    client.rpc("list_members_for_management", args)
  ]);
  if (roles.error) throw roleDatabaseError(roles.error);
  if (members.error) throw roleDatabaseError(members.error);
  return { roles: parseRoles(roles.data), members: parseMembers(members.data) };
}
export function roleCommand(operation: RoleOperation, client: RpcClient):
  OrganizationCommandDefinition<RoleInput, RoleReceipt> {
  return {
    operation: `roles.${operation}`, capability: capability("users.manage"), idempotency: "optional",
    validate: (raw) => validateRoleInput(operation, raw),
    async execute(context, input) {
      const common = { p_organization_id: context.actor.organizationId, p_request_id: context.requestId };
      const rpc = operation === "create" ? "create_custom_role" : operation === "update" ? "update_custom_role"
        : operation === "assign" ? "set_member_roles" : operation === "deactivate" ? "deactivate_member" : "transfer_ownership";
      const args = operation === "create" || operation === "update"
        ? { ...common, p_name: input.name, p_permission_codes: input.permissionCodes,
          ...(operation === "update" ? { p_role_id: input.roleId } : {}) }
        : operation === "assign" ? { ...common, p_member_id: input.memberId, p_role_ids: input.roleIds }
        : operation === "deactivate" ? { ...common, p_member_id: input.memberId }
        : { ...common, p_target_member_id: input.memberId };
      const result = await client.rpc(rpc, args);
      if (result.error) throw roleDatabaseError(result.error);
      const messages = { create: "Custom role created.", update: "Custom role updated.",
        assign: "Member roles updated.", deactivate: "Member access removed.", transfer: "Ownership transferred." };
      return { message: messages[operation],
        ...(operation === "create" ? { roleId: parseUuid(result.data, "role_id") } : {}) };
    }
  };
}
