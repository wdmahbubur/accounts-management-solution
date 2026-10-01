import type { SupabaseClient } from "@supabase/supabase-js";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import { accountDatabaseError, mappingKeys, parseCatalog, validateAccountInput, object } from "./contracts.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { capability } from "@ams/permissions";

type RpcClient=Pick<SupabaseClient,"rpc">;
export async function readAccountCatalog(client:RpcClient,actor:ActorContext){
  if(!actor.capabilities.includes("accounting.read"))throw CommandError.forbidden();
  const result=await client.rpc("list_accounts_for_management",{p_organization_id:actor.organizationId});
  if(result.error)throw accountDatabaseError(result.error);
  return parseCatalog(result.data);
}
export type AccountCommandInput=ReturnType<typeof validateAccountInput>;
export interface AccountReceipt { accountId:string; rowVersion:number }
export function saveAccountCommand(client:RpcClient):OrganizationCommandDefinition<AccountCommandInput,AccountReceipt>{
  return {operation:"accounts.save",capability:capability("accounting.read"),idempotency:"optional",validate:validateAccountInput,
    async execute(context,input){
      if(!context.actor.capabilities.includes("journal.write"))throw CommandError.forbidden();
      const r=await client.rpc("save_account",{p_organization_id:context.actor.organizationId,p_request_id:context.requestId,
        p_account_id:input.accountId,p_expected_version:input.expectedVersion,p_code:input.code,p_name:input.name,p_parent_id:input.parentId,
        p_account_type:input.accountType,p_normal_side:input.normalSide,p_report_group:input.reportGroup,p_control_kind:input.controlKind,
        p_is_postable:input.isPostable,p_is_active:input.isActive});
      if(r.error)throw accountDatabaseError(r.error);
      if(!Array.isArray(r.data)||r.data.length!==1)throw new Error("Invalid account receipt.");
      const row=object(r.data[0]);
      return {accountId:String(row.account_id),rowVersion:Number(row.row_version)};
    }};
}
export interface MappingInput { key:typeof mappingKeys[number]; accountId:string; expectedVersion:number }
export function validateMappingInput(raw:unknown):MappingInput{
  const v=object(raw); if(Object.keys(v).some(k=>!(["mapping_key","account_id","expected_version"] as string[]).includes(k)))throw CommandError.validation({body:"Unexpected request field."});
  if(typeof v.mapping_key!=="string"||!(mappingKeys as readonly string[]).includes(v.mapping_key))throw CommandError.validation({mapping_key:"Choose a supported mapping."});
  if(!Number.isSafeInteger(v.expected_version)||Number(v.expected_version)<1)throw CommandError.validation({expected_version:"Refresh the current mapping version."});
  const accountId=typeof v.account_id==="string"?v.account_id:"";
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId))throw CommandError.validation({account_id:"Select an account."});
  return {key:v.mapping_key as MappingInput["key"],accountId,expectedVersion:Number(v.expected_version)};
}
export interface MappingReceipt { key:string; accountId:string; rowVersion:number }
export function setMappingCommand(client:RpcClient):OrganizationCommandDefinition<MappingInput,MappingReceipt>{
  return {operation:"accounts.mapping.set",capability:capability("accounting.read"),idempotency:"optional",validate:validateMappingInput,
    async execute(context,input){
      if(!context.actor.capabilities.includes("journal.write"))throw CommandError.forbidden();
      const r=await client.rpc("set_account_mapping",{p_organization_id:context.actor.organizationId,p_request_id:context.requestId,
        p_mapping_key:input.key,p_account_id:input.accountId,p_expected_version:input.expectedVersion});
      if(r.error)throw accountDatabaseError(r.error);
      if(!Array.isArray(r.data)||r.data.length!==1)throw new Error("Invalid mapping receipt.");
      const row=object(r.data[0]);return {key:String(row.mapping_key),accountId:String(row.account_id),rowVersion:Number(row.row_version)};
    }};
}
