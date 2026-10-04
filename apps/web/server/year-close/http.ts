import {parseOrganizationId,parseUuid,parseMutationHeaders} from "@ams/contracts";
import {resolveActorContext} from "../auth/resolve-actor.ts";
import {CommandError,commandErrorBody,normalizeCommandError} from "../commands/errors.ts";
import {generateRequestId,hashCanonicalRequest} from "../commands/request-context.ts";
import {roleRuntime} from "../roles/runtime.ts";
const headers={"Cache-Control":"private, no-store"};
function response(error:unknown,requestId:string){const normalized=normalizeCommandError(error);return Response.json(commandErrorBody(normalized,requestId),{status:normalized.status,headers});}
function inputReason(raw:unknown){if(!raw||typeof raw!=="object"||Array.isArray(raw))throw CommandError.validation({body:"Expected a JSON object."});const value=raw as Record<string,unknown>;if(Object.keys(value).some(key=>key!=="reason")||typeof value.reason!=="string"||value.reason.trim().length<10||value.reason.trim().length>1000)throw CommandError.validation({reason:"Explain this action in 10-1000 characters."});return value.reason.trim();}
export async function yearClosePreview(_request:Request,context:{params:Promise<{organizationId:string;fiscalYearId:string}>}){
  const requestId=generateRequestId();try{const params=await context.params,organizationId=parseOrganizationId(params.organizationId),fiscalYearId=parseUuid(params.fiscalYearId),runtime=await roleRuntime(),actor=await resolveActorContext(organizationId,runtime.dependencies);
    if(!actor.capabilities.includes("accounting.read"))throw CommandError.forbidden();const result=await runtime.client.rpc("read_year_close_preview",{p_organization_id:organizationId,p_fiscal_year_id:fiscalYearId});
    if(result.error){if(result.error.code==="P0002")throw CommandError.notFound();if(result.error.code==="42501")throw CommandError.forbidden();throw new Error("Year-close preview could not be calculated.");}
    return Response.json({data:result.data,meta:{request_id:requestId,replayed:false}},{headers});
  }catch(error){return response(error,requestId);}
}
export async function mutateYearClose(request:Request,context:{params:Promise<{organizationId:string;fiscalYearId:string}>},action:"close"|"reopen"){
  const requestId=generateRequestId();try{const params=await context.params,organizationId=parseOrganizationId(params.organizationId),fiscalYearId=parseUuid(params.fiscalYearId),reason=inputReason(await request.json()),operation=`fiscal-year.${action}:${fiscalYearId}`;
    const parsed=parseMutationHeaders(request.headers,{idempotency:"required"});const resolvedRequestId=parsed.requestId??requestId;const idempotencyKey=parsed.idempotencyKey;if(!idempotencyKey)throw CommandError.validation({"Idempotency-Key":"An idempotency key is required."});
    const runtime=await roleRuntime(),actor=await resolveActorContext(organizationId,runtime.dependencies);const capability=action==="close"?"periods.lock":"periods.reopen";if(!actor.capabilities.includes(capability))throw CommandError.forbidden();
    const requestHash=hashCanonicalRequest({operation,organizationId,payload:{reason}});const result=await runtime.client.rpc(action==="close"?"close_fiscal_year":"reopen_fiscal_year",{
      p_organization_id:organizationId,p_fiscal_year_id:fiscalYearId,p_request_id:resolvedRequestId,p_idempotency_key:idempotencyKey,p_request_hash:requestHash,p_reason:reason});
    if(result.error){if(result.error.code==="28000")throw CommandError.unauthenticated();if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="P0002")throw CommandError.notFound();if(result.error.code==="40001")throw CommandError.conflict("STALE_VERSION");if(result.error.code==="23505")throw CommandError.conflict("IDEMPOTENCY_CONFLICT");if(result.error.code==="22023")throw CommandError.validation({reason:"Check the reason and request details."});if(result.error.code==="23514")throw CommandError.validation({period:"Close checks or fiscal-year state prevent this action."});throw new Error(`Fiscal year ${action} failed.`);}
    return Response.json({data:result.data,meta:{request_id:resolvedRequestId,replayed:false}},{headers});
  }catch(error){return response(error,requestId);}
}
