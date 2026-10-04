import { parseOrganizationId,parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError,commandErrorBody,normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
const kinds=["cash","bank","mobile_wallet","payment_clearing"] as const;
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){const id=generateRequestId();try{
 const org=parseOrganizationId((await context.params).organizationId);const actor=await resolveActorContext(org,(await roleRuntime()).dependencies);if(!actor.capabilities.includes("banking.write"))throw CommandError.forbidden();
 const body=await request.json() as Record<string,unknown>;if(Object.keys(body).some(k=>!(["name","kind","account_id","institution","masked_account_number","is_cash_equivalent","allow_negative_balance"] as string[]).includes(k)))throw CommandError.validation({body:"Unexpected field."});
 const name=typeof body.name==="string"?body.name.trim():"";const kind=body.kind;const accountId=parseUuid(body.account_id,"account_id");if(!name||name.length>120||typeof kind!=="string"||!(kinds as readonly string[]).includes(kind)||typeof body.is_cash_equivalent!=="boolean"||typeof body.allow_negative_balance!=="boolean")throw CommandError.validation({body:"Check the account fields."});
 for(const field of ["institution","masked_account_number"] as const)if(body[field]!==null&&body[field]!==undefined&&(typeof body[field]!=="string"||body[field].length>(field==="institution"?120:80)))throw CommandError.validation({[field]:"Value is too long."});
 const runtime=await roleRuntime();const result=await runtime.client.rpc("save_cash_account",{p_organization_id:org,p_name:name,p_kind:kind,p_account_id:accountId,p_institution:body.institution||null,p_masked_account_number:body.masked_account_number||null,p_is_cash_equivalent:body.is_cash_equivalent,p_allow_negative_balance:body.allow_negative_balance});if(result.error)throw new Error("Cash account could not be saved.");return Response.json({data:{id:result.data},meta:{request_id:id}},{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,id),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}}
