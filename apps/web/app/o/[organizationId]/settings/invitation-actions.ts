"use server";
import type { ApiResult } from "@ams/contracts";
import { headers } from "next/headers";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../server/commands/errors.ts";
import { executeOrganizationCommand } from "../../../../server/commands/execute.ts";
import { generateRequestId } from "../../../../server/commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../../../../server/company-context.ts";
import type { InvitationOperation, InvitationReceipt } from "../../../../server/invitations/contracts.ts";
import { invitationCommand } from "../../../../server/invitations/service.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
export async function manageInvitationAction(_previous: ApiResult<InvitationReceipt> | null, form: FormData): Promise<ApiResult<InvitationReceipt>> {
  try {
    const operation = form.get("operation");
    if (operation !== "create" && operation !== "resend" && operation !== "revoke") throw CommandError.validation({ operation: "Choose an invitation action." });
    if (operation === "revoke" && form.get("confirmed") !== "yes") throw CommandError.validation({ confirmed: "Confirm invitation revocation." });
    const runtime = await roleRuntime();
    const context = assertFreshCompanySubmission({ expectedOrganizationId: form.get("company"), expectedNonce: form.get("company_context"), current: runtime.current });
    const result = await executeOrganizationCommand({ definition: invitationCommand(operation as InvitationOperation, runtime.client),
      organizationId: context.organizationId, rawInput: operation === "create" ? { email: form.get("email"), role_id: form.get("role_id") } : { invitation_id: form.get("invitation_id") },
      headers: await headers(), dependencies: runtime.dependencies });
    return result.body;
  } catch (error) { return commandErrorBody(error instanceof StaleCompanyContextError ? new CommandError({ code: "STALE_VERSION", message: "Company context changed. Reload before submitting." }) : normalizeCommandError(error), generateRequestId()); }
}
