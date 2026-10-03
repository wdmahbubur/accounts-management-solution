import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

const headers={"Cache-Control":"private, no-store"};
function validDate(value:unknown):value is string{if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(`${value}T00:00:00Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
function validRows(rows:unknown):rows is Array<{account_id:string;debit:string;credit:string}>{return Array.isArray(rows)&&rows.length<=500&&rows.every(row=>!!row&&typeof row==="object"&&!Array.isArray(row)&&Object.keys(row).length===3&&typeof row.account_id==="string"&&/^[0-9a-f-]{36}$/i.test(row.account_id)&&typeof row.debit==="string"&&/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(row.debit)&&typeof row.credit==="string"&&/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(row.credit));}
export async function GET(_request:Request,context:{params:Promise<{organizationId:string;documentId:string}>}){
 const requestId=generateRequestId();
 try{const params=await context.params;const organizationId=parseOrganizationId(params.organizationId);const documentId=parseUuid(params.documentId);const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);if(!actor.capabilities.includes("accounting.read"))throw CommandError.forbidden();
  const result=await runtime.client.rpc("read_opening_cutover_summary",{p_organization_id:organizationId,p_document_id:documentId});if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="P0002")throw CommandError.notFound();throw new Error("Opening cutover evidence could not be loaded.");}if(!result.data||typeof result.data!=="object"||Array.isArray(result.data))throw CommandError.notFound();
  return new Response(JSON.stringify({data:result.data,meta:{request_id:requestId}},null,2),{headers:{...headers,"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="opening-cutover-${documentId}.json"`}});
 }catch(error){const safe=normalizeCommandError(error);return Response.json(commandErrorBody(safe,requestId),{status:safe.status,headers});}
}
export async function POST(request:Request,context:{params:Promise<{organizationId:string;documentId:string}>}){
 const requestId=generateRequestId();
 try{
  const params=await context.params;const organizationId=parseOrganizationId(params.organizationId);const documentId=parseUuid(params.documentId);const runtime=await roleRuntime();
  const actor=await resolveActorContext(organizationId,runtime.dependencies);if(!actor.capabilities.includes("journal.write"))throw CommandError.forbidden();
  let body:unknown;try{body=await request.json();}catch{throw CommandError.validation({body:"Send a valid JSON object."});}
  if(!body||typeof body!=="object"||Array.isArray(body))throw CommandError.validation({body:"Send a valid JSON object."});
  const input=body as Record<string,unknown>;if(Object.keys(input).some(key=>!['cutover_date','prior_trial_balance','ytd_summary','evidence_reference'].includes(key)))throw CommandError.validation({body:"Unexpected request field."});
  if(!validDate(input.cutover_date)||!validRows(input.prior_trial_balance)||!validRows(input.ytd_summary)||typeof input.evidence_reference!=="string"||input.evidence_reference.trim().length<1||input.evidence_reference.trim().length>500)throw CommandError.validation({body:"Provide a cutover date, exact trial-balance amounts, nominal YTD summary and source evidence reference."});
  const result=await runtime.client.rpc("save_opening_cutover_summary",{p_organization_id:organizationId,p_document_id:documentId,p_cutover_date:input.cutover_date,p_prior_trial_balance:input.prior_trial_balance,p_ytd_summary:input.ytd_summary,p_evidence_reference:input.evidence_reference.trim()});
  if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="P0002")throw CommandError.notFound();if(["22023","23514","23503","22P02"].includes(result.error.code??""))throw CommandError.validation({cutover:result.error.message??"Cutover details do not match the source journal."});throw new Error("Opening cutover summary could not be saved.");}
  return Response.json({data:result.data,meta:{request_id:requestId}},{headers});
 }catch(error){const safe=normalizeCommandError(error);return Response.json(commandErrorBody(safe,requestId),{status:safe.status,headers});}
}
