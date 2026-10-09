import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { cashAccountSaveError, readCashAccountMapping } from "../../../../../../server/banking/cash-accounts.ts";
import { parseCashAccountInput } from "../../../../../../lib/cash-account-requests.ts";

type Context = { params: Promise<{ organizationId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request, context: Context) {
  const requestId = generateRequestId();
  try {
    const org = parseOrganizationId((await context.params).organizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(org, runtime.dependencies);
    if (!actor.capabilities.includes("banking.write")) throw CommandError.forbidden();
    let raw: unknown;
    try { raw = await request.json(); } catch { throw CommandError.validation({ body: "Enter valid account details." }); }
    const body = parseCashAccountInput(raw);
    const result = await runtime.client.rpc("save_cash_account", { p_organization_id: org, p_name: body.name, p_kind: body.kind,
      p_account_id: body.account_id, p_institution: body.institution, p_masked_account_number: body.masked_account_number,
      p_is_cash_equivalent: body.is_cash_equivalent, p_allow_negative_balance: body.allow_negative_balance });
    if (result.error) throw cashAccountSaveError(result.error);
    let id: string;
    try { id = parseUuid(result.data); } catch { throw new Error("Cash account save result was unconfirmed."); }
    return Response.json({ data: { id, organization_id: org, account_id: body.account_id }, meta: { request_id: requestId } }, { status: 201, headers });
  } catch (error) {
    const failure = normalizeCommandError(error);
    return Response.json(commandErrorBody(failure, requestId), { status: failure.status, headers });
  }
}

/** Read-only recovery of a creation whose response was lost. */
export async function GET(request: Request, context: Context) {
  const requestId = generateRequestId();
  try {
    const org = parseOrganizationId((await context.params).organizationId);
    const accountId = parseUuid(new URL(request.url).searchParams.get("account_id"), "account_id");
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(org, runtime.dependencies);
    const account = await readCashAccountMapping(runtime.client, actor, accountId);
    return Response.json({ data: { organization_id: org, account_id: accountId, account }, meta: { request_id: requestId } }, { headers });
  } catch (error) {
    const failure = normalizeCommandError(error);
    return Response.json(commandErrorBody(failure, requestId), { status: failure.status, headers });
  }
}
