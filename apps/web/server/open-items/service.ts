import type { RequestClient } from "../request-client.ts";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import { parseOpenItemList, type ControlKind } from "./contracts.ts";

type RpcClient=Pick<RequestClient,"rpc">;
export async function readOpenItems(client:RpcClient,actor:ActorContext,input:{asOf:string;cutoff:string;partyId:string|null;controlKind:ControlKind|null;limit:number}){
  if(!actor.capabilities.includes("dues.read"))throw CommandError.forbidden();
  const result=await client.rpc("list_open_items",{p_organization_id:actor.organizationId,p_as_of:input.asOf,p_cutoff:input.cutoff,
    p_party_id:input.partyId,p_control_kind:input.controlKind,p_limit:input.limit});
  if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="28000")throw CommandError.unauthenticated();
    if(result.error.code==="22023")throw CommandError.validation({query:"The open-item query conflicts with the supported filters."});throw new Error("Open-item query failed.");}
  return parseOpenItemList(result.data);
}
