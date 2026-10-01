import { parseMoneyString, parseUuid, type MoneyString, type Uuid } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";

export const controlKinds=["ar","ap","customer_advance","vendor_advance"] as const;
export type ControlKind=typeof controlKinds[number];
export interface OpenItem {id:Uuid;journalLineId:Uuid;sourceDocumentId:Uuid;documentNumber:string|null;accountId:Uuid;partyId:Uuid;partyName:string;controlKind:ControlKind;side:"debit"|"credit";originalAmount:MoneyString;availableAmount:MoneyString;reference:string;issueDate:string;dueDate:string|null}
export function parseOpenItemList(raw:unknown):OpenItem[]{
  if(!Array.isArray(raw))throw new Error("Invalid open-item response.");
  return raw.map((value)=>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid open-item row.");const r=value as Record<string,unknown>;
    if(typeof r.party_name!=="string"||typeof r.reference!=="string"||typeof r.issue_date!=="string"||!(r.due_date===null||typeof r.due_date==="string")||
       !(r.document_number===null||typeof r.document_number==="string")||!(r.side==="debit"||r.side==="credit")||typeof r.control_kind!=="string"||!controlKinds.includes(r.control_kind as ControlKind))throw new Error("Invalid open-item row.");
    return{id:parseUuid(r.open_item_id),journalLineId:parseUuid(r.journal_line_id),sourceDocumentId:parseUuid(r.source_document_id),documentNumber:r.document_number,
      accountId:parseUuid(r.account_id),partyId:parseUuid(r.party_id),partyName:r.party_name,controlKind:r.control_kind as ControlKind,side:r.side,
      originalAmount:parseMoneyString(r.original_amount),availableAmount:parseMoneyString(r.available_amount),reference:r.reference,issueDate:r.issue_date,dueDate:r.due_date};});
}
export function parseOpenItemFilters(query:URLSearchParams){
  if([...query.keys()].some((key)=>!["as_of","cutoff","party_id","control_kind","limit"].includes(key)))throw CommandError.validation({query:"Unknown open-item filter."});
  const asOf=query.get("as_of");const parsedDate=asOf&&/^\d{4}-\d{2}-\d{2}$/.test(asOf)?new Date(`${asOf}T00:00:00Z`):null;
  if(!asOf||!parsedDate||Number.isNaN(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==asOf)throw CommandError.validation({as_of:"Use a valid as-of date."});
  const rawCutoff=query.get("cutoff");const cutoff=rawCutoff??new Date().toISOString();if(Number.isNaN(Date.parse(cutoff)))throw CommandError.validation({cutoff:"Use a valid ISO timestamp."});
  const partyId=query.get("party_id");if(partyId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(partyId))throw CommandError.validation({party_id:"Use a valid company party ID."});
  const kind=query.get("control_kind");if(kind&&!controlKinds.includes(kind as ControlKind))throw CommandError.validation({control_kind:"Choose a supported control type."});
  const rawLimit=query.get("limit");if(rawLimit!==null&&!/^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/.test(rawLimit))throw CommandError.validation({limit:"Use a page size of 1-200."});
  return{asOf,cutoff,partyId,controlKind:kind as ControlKind|null,limit:rawLimit===null?100:Number(rawLimit)};
}
