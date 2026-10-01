import type { SupabaseClient } from "@supabase/supabase-js";
import { capability } from "@ams/permissions";
import type { ActorContext } from "../auth/types.ts";
import { CommandError } from "../commands/errors.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { parseSettings, settingsInput, type SettingsInput, type SettingsReceipt } from "./contracts.ts";
type RpcClient = Pick<SupabaseClient, "rpc">;
export function settingsDatabaseError(error: { code?: string }): CommandError {
  if (error.code === "28000") return CommandError.unauthenticated();
  if (error.code === "42501") return new CommandError({ code: "FORBIDDEN", message: "Company access or a recent sign-in is required. Sign in again and check your permissions." });
  if (error.code === "P0002") return CommandError.notFound();
  if (error.code === "P0409") return new CommandError({ code: "STALE_VERSION", message: "Settings changed since you opened this form. Reload the latest version before saving." });
  if (error.code === "P0412") return new CommandError({ code: "PERIOD_LOCKED", message: "Accounting setup is locked after activity. Books start and fiscal policy cannot be rewritten." });
  if (["22023", "22007", "22008", "23P01", "23514"].includes(error.code ?? "")) return CommandError.validation({ settings: "Check company details, dates and fiscal calendar. Periods must not overlap." });
  return new CommandError({ code: "INTERNAL_ERROR" });
}
export async function readCompanySettings(client: RpcClient, actor: ActorContext) {
  if (!actor.capabilities.includes("company.read")) throw CommandError.forbidden();
  const result = await client.rpc("read_company_settings", { p_organization_id: actor.organizationId });
  if (result.error) throw settingsDatabaseError(result.error);
  return parseSettings(result.data, actor.organizationId);
}
export function companySettingsCommand(client: RpcClient): OrganizationCommandDefinition<SettingsInput, SettingsReceipt> {
  return { operation: "company.settings.update", capability: capability("company.update"), idempotency: "optional",
    validate: settingsInput,
    async execute(context, input) {
      const result = await client.rpc("update_company_settings", { p_organization_id: context.actor.organizationId,
        p_expected_version: input.expectedVersion, p_changes: input.changes, p_reason: input.reason, p_request_id: context.requestId });
      if (result.error) throw settingsDatabaseError(result.error);
      if (!Number.isInteger(result.data) || result.data < 1 || result.data > 2147483647) throw new Error("Invalid saved settings version.");
      return { settingsVersion: result.data, message: "Company settings saved. Existing financial records have not been rewritten." };
    } };
}
