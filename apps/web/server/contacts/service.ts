import type { RequestClient } from "../request-client.ts";
import { capability } from "@ams/permissions";
import { parseUuid } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { record } from "../documents/contracts.ts";

type RpcClient=Pick<RequestClient,"rpc">;export type ContactScope="customer"|"vendor";
export interface ContactInput { display_name:string;legal_name:string|null;is_customer:boolean;is_vendor:boolean;email:string|null;phone:string|null;billing_address:Record<string,unknown>;tax_identifiers:Record<string,unknown>;payment_terms_days:number;credit_limit:string|null;external_key:string|null;is_active:boolean }
function text(v:unknown,field:string,max:number,nullable=false){if(nullable&&v===null)return null;if(typeof v!=="string"||v.trim().length>max||(!nullable&&!v.trim()))throw CommandError.validation({[field]:`Use ${nullable?"at most":"1-"+max} ${max} characters.`});return v.trim()||null;}
function json(v:unknown,field:string){if(v===undefined||v===null)return{};const r=record(v,field);if(JSON.stringify(r).length>10000)throw CommandError.validation({[field]:"Use an object under 10 KB."});return r;}
function validate(raw:unknown):ContactInput{const r=record(raw,"contact");const allowed=["display_name","legal_name","is_customer","is_vendor","email","phone","billing_address","tax_identifiers","payment_terms_days","credit_limit","external_key","is_active"];
 if(Object.keys(r).some(k=>!allowed.includes(k)))throw CommandError.validation({contact:"Unexpected contact field."});
 if(typeof r.is_customer!=="boolean"||typeof r.is_vendor!=="boolean"||(!r.is_customer&&!r.is_vendor))throw CommandError.validation({roles:"Select customer, vendor, or both."});
 if(!Number.isSafeInteger(r.payment_terms_days)||Number(r.payment_terms_days)<0||Number(r.payment_terms_days)>3650)throw CommandError.validation({payment_terms_days:"Use 0-3650 days."});
 if(r.is_active!==undefined&&typeof r.is_active!=="boolean")throw CommandError.validation({is_active:"Expected true or false."});
 let creditLimit:string|null=null;if(r.credit_limit!==null&&r.credit_limit!==undefined&&r.credit_limit!==""){if(typeof r.credit_limit!=="string"||!/^(0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(r.credit_limit))throw CommandError.validation({credit_limit:"Use a nonnegative BDT amount with up to two decimals."});creditLimit=r.credit_limit;}
 const email=text(r.email??null,"email",254,true);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw CommandError.validation({email:"Use a valid email address."});
 return{display_name:text(r.display_name,"display_name",200)!,legal_name:text(r.legal_name??null,"legal_name",200,true),is_customer:r.is_customer,is_vendor:r.is_vendor,email,phone:text(r.phone??null,"phone",40,true),billing_address:json(r.billing_address,"billing_address"),tax_identifiers:json(r.tax_identifiers,"tax_identifiers"),payment_terms_days:Number(r.payment_terms_days),credit_limit:creditLimit,external_key:text(r.external_key??null,"external_key",160,true),is_active:r.is_active!==false};}
export async function readContactDirectory(client:RpcClient,actor:ActorContext,input:{scope:ContactScope;search:string|null;status:"active"|"inactive"|"overdue"|"all";after:string|null;limit:number}){
 const required=input.scope==="customer"?"sales.read":"purchases.read";if(!actor.capabilities.includes(required))throw CommandError.forbidden();
 if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||input.search&&input.search.length>100)throw CommandError.validation({query:"Invalid contact filters."});
 const after=input.after?parseUuid(input.after,"after"):null;const r=await client.rpc("read_contact_directory",{p_organization_id:actor.organizationId,p_scope:input.scope,p_search:input.search,p_status:input.status,p_after:after,p_limit:input.limit});
 if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();throw new Error("Contact directory query failed.");}return record(r.data,"directory");
}
export async function readContactProfile(client:RpcClient,actor:ActorContext,scope:ContactScope,id:string){
 const required=scope==="customer"?"sales.read":"purchases.read";if(!actor.capabilities.includes(required))throw CommandError.forbidden();
 const r=await client.rpc("read_contact_profile",{p_organization_id:actor.organizationId,p_contact_id:parseUuid(id,"contact_id"),p_scope:scope,p_cutoff:new Date().toISOString(),p_limit:100});
 if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();if(r.error.code==="P0002")throw CommandError.notFound();throw new Error("Contact profile query failed.");}return record(r.data,"profile");
}
export function saveContactCommand(client:RpcClient,contactId:string|null):OrganizationCommandDefinition<{expectedVersion:number|null;contact:ContactInput},Record<string,unknown>>{return{
 operation:contactId?`contacts.save:${contactId}`:"contacts.save",capability:capability("contacts.write"),idempotency:"required",
 validate(raw){const r=record(raw);if(Object.keys(r).some(k=>!(k==="expected_version"||k==="contact")))throw CommandError.validation({body:"Unexpected request field."});const version=r.expected_version===null?null:r.expected_version;
  if(contactId&&(!Number.isSafeInteger(version)||Number(version)<1))throw CommandError.validation({expected_version:"Refresh this contact before saving."});if(!contactId&&version!==null)throw CommandError.validation({expected_version:"New contacts do not have a prior version."});return{expectedVersion:version===null?null:Number(version),contact:validate(r.contact)};},
 async execute(context,input){if(!context.idempotencyKey)throw CommandError.validation({idempotency_key:"A stable idempotency key is required."});const result=await client.rpc("save_contact",{p_organization_id:context.actor.organizationId,p_contact_id:contactId,p_expected_version:input.expectedVersion,
  p_request_id:context.requestId,p_idempotency_key:context.idempotencyKey,p_request_hash:context.requestHash,p_payload:input.contact});
  if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="P0002")throw CommandError.notFound();if(result.error.code==="40001")throw CommandError.conflict("STALE_VERSION");if(result.error.code==="23505"){if(/idempotency/i.test(result.error.message??""))throw CommandError.conflict("IDEMPOTENCY_CONFLICT");throw CommandError.validation({external_key:"This external reference is already in use."});}if(["22023","23514","22P02"].includes(result.error.code??""))throw CommandError.validation({contact:"The contact conflicts with role history or a field rule."});throw new Error("Contact could not be saved.");}return record(result.data,"contact");}
};}
