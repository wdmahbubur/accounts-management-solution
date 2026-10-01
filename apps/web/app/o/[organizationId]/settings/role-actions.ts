"use server";

import type { ApiResult } from "@ams/contracts";
import { headers } from "next/headers";
import { commandErrorBody, CommandError, normalizeCommandError } from "../../../../server/commands/errors.ts";
import { executeOrganizationCommand } from "../../../../server/commands/execute.ts";
import { generateRequestId } from "../../../../server/commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../../../../server/company-context.ts";
import type { RoleOperation, RoleReceipt } from "../../../../server/roles/contracts.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
import { roleCommand } from "../../../../server/roles/service.ts";

export async function changeRoleAction(_previous: ApiResult<RoleReceipt> | null,
  form: FormData): Promise<ApiResult<RoleReceipt>> {
  try {
    const operation = form.get("operation");
    if (typeof operation !== "string" || !["create", "update", "assign", "deactivate", "transfer"].includes(operation)) {
      throw CommandError.validation({ operation: "Choose a valid action." });
    }
    if ((operation === "transfer" || operation === "deactivate") && form.get("confirmed") !== "yes") {
      throw CommandError.validation({ confirmed: "Confirm the access change before continuing." });
    }
    const runtime = await roleRuntime();
    const current = assertFreshCompanySubmission({ expectedOrganizationId: form.get("company"),
      expectedNonce: form.get("company_context"), current: runtime.current });
    const rawInput = operation === "create" || operation === "update"
      ? { name: form.get("name"), permission_codes: form.getAll("permission_codes"),
        ...(operation === "update" ? { role_id: form.get("role_id") } : {}) }
      : operation === "assign" ? { member_id: form.get("member_id"), role_ids: form.getAll("role_ids") }
      : { member_id: form.get("member_id") };
    const result = await executeOrganizationCommand({ definition: roleCommand(operation as RoleOperation, runtime.client),
      organizationId: current.organizationId, rawInput, headers: await headers(), dependencies: runtime.dependencies });
    return result.body;
  } catch (error) {
    const normalized = error instanceof StaleCompanyContextError
      ? new CommandError({ code: "STALE_VERSION", message: "Company context changed. Reload before submitting." })
      : normalizeCommandError(error);
    return commandErrorBody(normalized, generateRequestId());
  }
}
