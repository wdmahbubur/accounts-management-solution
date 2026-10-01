"use server";
import { headers } from "next/headers";
import type { ApiResult } from "@ams/contracts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../server/commands/errors.ts";
import { executeOrganizationCommand } from "../../../../../server/commands/execute.ts";
import { generateRequestId } from "../../../../../server/commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../../../../../server/company-context.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { addressKeys, settingTextLimits, type SettingsReceipt } from "../../../../../server/settings/contracts.ts";
import { companySettingsCommand } from "../../../../../server/settings/service.ts";
export async function saveCompanySettings(_previous: ApiResult<SettingsReceipt> | null, form: FormData): Promise<ApiResult<SettingsReceipt>> {
  try {
    const runtime = await roleRuntime();
    const context = assertFreshCompanySubmission({ expectedOrganizationId: form.get("company"), expectedNonce: form.get("company_context"), current: runtime.current });
    const changes: Record<string, unknown> = {};
    for (const field of Object.keys(settingTextLimits)) if (form.has(field)) changes[field] = form.get(field);
    if (form.has("fiscal_year_start_month")) changes.fiscal_year_start_month = Number(form.get("fiscal_year_start_month"));
    const address = Object.fromEntries(addressKeys.filter(k => form.has(`address.${k}`)).map(k => [k, form.get(`address.${k}`)]));
    if (Object.keys(address).length) changes.address = address;
    const result = await executeOrganizationCommand({ definition: companySettingsCommand(runtime.client), organizationId: context.organizationId,
      rawInput: { expected_version: Number(form.get("expected_version")), changes, reason: form.get("reason") },
      headers: await headers(), dependencies: runtime.dependencies });
    return result.body;
  } catch (error) {
    return commandErrorBody(error instanceof StaleCompanyContextError ? new CommandError({ code: "STALE_VERSION", message: "Company context changed. Reload before submitting." }) : normalizeCommandError(error), generateRequestId());
  }
}
