import type { RequestClient } from "../request-client.ts";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { capability } from "@ams/permissions";
import { object, parseTaxCatalog, taxDatabaseError, validateArchiveTax, validateTaxVersion, type ArchiveTaxInput, type TaxVersionInput } from "./contracts.ts";

type RpcClient = Pick<RequestClient, "rpc">;
export async function readTaxCatalog(client: RpcClient, actor: ActorContext) {
  if (!actor.capabilities.includes("tax.read")) throw CommandError.forbidden();
  const [codes, accounts] = await Promise.all([
    client.rpc("list_tax_codes", { p_organization_id: actor.organizationId }),
    client.rpc("list_tax_mapping_accounts", { p_organization_id: actor.organizationId })
  ]);
  if (codes.error) throw taxDatabaseError(codes.error);
  if (accounts.error) throw taxDatabaseError(accounts.error);
  return parseTaxCatalog(codes.data, accounts.data);
}
export interface TaxVersionReceipt { taxCodeId: string; versionNo: number; rowVersion: number }
export function createTaxVersionCommand(client: RpcClient): OrganizationCommandDefinition<TaxVersionInput, TaxVersionReceipt> {
  return { operation: "tax.version.create", capability: capability("tax.manage"), idempotency: "optional", validate: validateTaxVersion,
    async execute(context, input) {
      const result = await client.rpc("create_tax_code_version", { p_organization_id: context.actor.organizationId, p_request_id: context.requestId,
        p_reason: input.reason, p_code: input.code, p_label: input.label,
        p_rate_percent: input.ratePercent, p_tax_kind: input.taxKind, p_output_account_id: input.outputAccountId,
        p_input_account_id: input.inputAccountId, p_recoverability: input.recoverability, p_effective_from: input.effectiveFrom,
        p_effective_to: input.effectiveTo, p_expected_latest_row_version: input.expectedLatestRowVersion });
      if (result.error) throw taxDatabaseError(result.error);
      if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error("Invalid tax-version receipt.");
      const row = object(result.data[0]);
      return { taxCodeId: String(row.tax_code_id), versionNo: Number(row.version_no), rowVersion: Number(row.row_version) };
    } };
}
export interface ArchiveTaxReceipt { rowVersion: number }
export function archiveTaxVersionCommand(client: RpcClient): OrganizationCommandDefinition<ArchiveTaxInput, ArchiveTaxReceipt> {
  return { operation: "tax.version.archive", capability: capability("tax.manage"), idempotency: "optional", validate: validateArchiveTax,
    async execute(context, input) {
      const result = await client.rpc("archive_tax_code_version", { p_organization_id: context.actor.organizationId, p_tax_code_id: input.taxCodeId,
        p_expected_row_version: input.expectedRowVersion, p_request_id: context.requestId, p_reason: input.reason });
      if (result.error) throw taxDatabaseError(result.error);
      return { rowVersion: Number(result.data) };
    } };
}
