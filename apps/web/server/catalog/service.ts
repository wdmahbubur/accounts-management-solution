import type { SupabaseClient } from "@supabase/supabase-js";
import { capability } from "@ams/permissions";
import { parseUuid } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { record } from "../documents/contracts.ts";

type RpcClient=Pick<SupabaseClient,"rpc">;
type ItemInput={sku:string|null;name:string;unit:string;default_unit_price:string;sales_account_id:string|null;purchase_account_id:string|null;tax_code_id:string|null;is_active:boolean};
type CenterInput={code:string;name:string;is_active:boolean};
function nullableText(value:unknown,field:string,max:number){if(value===null||value===undefined)return null;if(typeof value!=="string"||value.trim().length>max)throw CommandError.validation({[field]:`Use at most ${max} characters.`});return value.trim()||null;}
function text(value:unknown,field:string,max:number){if(typeof value!=="string"||!value.trim()||value.trim().length>max)throw CommandError.validation({[field]:`Enter 1-${max} characters.`});return value.trim();}
function optionalId(value:unknown,field:string){return value===null||value===undefined||value===""?null:parseUuid(value,field);}
function validateItem(value:unknown):ItemInput{const v=record(value,"item");const keys=["sku","name","unit","default_unit_price","sales_account_id","purchase_account_id","tax_code_id","is_active"];
 if(Object.keys(v).some(k=>!keys.includes(k)))throw CommandError.validation({item:"Unexpected catalogue item field."});
 if(typeof v.is_active!=="boolean")throw CommandError.validation({is_active:"Choose active or archived."});
 if(typeof v.default_unit_price!=="string"||!/^(0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(v.default_unit_price))throw CommandError.validation({default_unit_price:"Enter a nonnegative rate with up to six decimal places."});
 const [whole,fraction=""]=v.default_unit_price.split(".");return{sku:nullableText(v.sku,"sku",80),name:text(v.name,"name",160),unit:text(v.unit,"unit",40),default_unit_price:`${whole}.${fraction.padEnd(6,"0")}`,
  sales_account_id:optionalId(v.sales_account_id,"sales_account_id"),purchase_account_id:optionalId(v.purchase_account_id,"purchase_account_id"),tax_code_id:optionalId(v.tax_code_id,"tax_code_id"),is_active:v.is_active};}
function validateCenter(value:unknown):CenterInput{const v=record(value,"cost_center");if(Object.keys(v).some(k=>!["code","name","is_active"].includes(k)))throw CommandError.validation({cost_center:"Unexpected cost-center field."});
 if(typeof v.is_active!=="boolean")throw CommandError.validation({is_active:"Choose active or archived."});const code=text(v.code,"code",32);if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(code))throw CommandError.validation({code:"Use letters, numbers, dot, underscore or hyphen."});
 return{code:code.toUpperCase(),name:text(v.name,"name",120),is_active:v.is_active};}
function validateEnvelope(raw:unknown,id:string|null,key:"item"|"cost_center"){const r=record(raw);if(Object.keys(r).some(k=>k!=="expected_version"&&k!==key))throw CommandError.validation({body:"Unexpected request field."});
 const ver=r.expected_version===null||r.expected_version===undefined?null:r.expected_version;if(id&&(!Number.isSafeInteger(ver)||Number(ver)<1))throw CommandError.validation({expected_version:"Refresh before saving."});if(!id&&ver!==null)throw CommandError.validation({expected_version:"New records have no prior version."});
 return{expectedVersion:ver===null?null:Number(ver),payload:key==="item"?validateItem(r[key]):validateCenter(r[key])};}
function databaseError(error:{code?:string;message?:string;details?:string}){if(error.code==="42501")throw CommandError.forbidden();if(error.code==="P0002")throw CommandError.notFound();if(error.code==="40001")throw CommandError.conflict("STALE_VERSION");
 if(error.code==="23505"){if(/idempotency/i.test(error.message??""))throw CommandError.conflict("IDEMPOTENCY_CONFLICT");throw CommandError.validation({duplicate:"That code or SKU is already in use in this company."});}
 if(["22023","23514","22P02"].includes(error.code??""))throw CommandError.validation({catalog:error.message??"The selected catalogue values are incompatible."});throw new Error("Catalogue command failed.");}
export async function readServiceCatalog(client:RpcClient,actor:ActorContext){if(!actor.capabilities.includes("catalog.read"))throw CommandError.forbidden();const r=await client.rpc("list_service_catalog",{p_organization_id:actor.organizationId});if(r.error){databaseError(r.error);}return record(r.data,"catalogue");}
function saveCommand(client:RpcClient,id:string|null,key:"item"|"cost_center"):OrganizationCommandDefinition<{expectedVersion:number|null;payload:ItemInput|CenterInput},Record<string,unknown>>{
 const item=key==="item";return{operation:`catalog.${item?"item":"cost-center"}.save${id?`:${id}`:""}`,capability:capability("catalog.write"),idempotency:"required",
 validate(raw){return validateEnvelope(raw,id,key) as {expectedVersion:number|null;payload:ItemInput|CenterInput};},
 async execute(context,input){if(!context.idempotencyKey)throw CommandError.validation({idempotency_key:"A stable idempotency key is required."});
  const common={p_organization_id:context.actor.organizationId,p_expected_version:input.expectedVersion,p_request_id:context.requestId,p_idempotency_key:context.idempotencyKey,p_request_hash:context.requestHash,p_payload:input.payload};
  const args=item?{...common,p_item_id:id}:{...common,p_center_id:id};const r=await client.rpc(item?"save_service_item":"save_cost_center",args);
  if(r.error)databaseError(r.error);return record(r.data,"catalogue receipt");}};}
export function saveItemCommand(client:RpcClient,id:string|null){return saveCommand(client,id,"item");}
export function saveCostCenterCommand(client:RpcClient,id:string|null){return saveCommand(client,id,"cost_center");}
