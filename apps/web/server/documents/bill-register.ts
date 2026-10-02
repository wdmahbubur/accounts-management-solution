import { parseMoneyString, parseOrganizationId, parseUuid, type OrganizationId, type Uuid } from "@ams/contracts";
import type { RequestClient } from "../request-client.ts";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import { record } from "./contracts.ts";

export type BillTab = "all" | "drafts" | "awaiting_approval" | "posted";
export interface BillRow { id: Uuid; organizationId: OrganizationId; state: string; documentNumber: string|null; vendorName: string; invoiceReference: string|null; issueDate: string; dueDate: string|null; totalAmount: string; residualAmount: string|null; settlementStatus: string; duplicateReference: boolean; }
export async function readBillRegister(client:Pick<RequestClient,"rpc">,actor:ActorContext,input:{status:BillTab;search:string|null;after:string|null;limit:number}):Promise<{items:BillRow[];nextCursor:Uuid|null}>{
  if(!actor.capabilities.includes("purchases.read"))throw CommandError.forbidden();
  if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||input.search!==null&&input.search.length>100)throw CommandError.validation({query:"Use a search under 100 characters and a page size of 1-100."});
  const after=input.after?parseUuid(input.after,"after"):null;
  const r=await client.rpc("read_bill_register",{p_organization_id:actor.organizationId,p_status:input.status,p_search:input.search,p_after:after,p_limit:input.limit+1});
  if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();if(r.error.code==="P0002")throw CommandError.notFound();if(r.error.code==="22023")throw CommandError.validation({query:"Bill filters are invalid."});throw new Error("Bill register could not be loaded.");}
  if(!Array.isArray(r.data)||r.data.length>input.limit+1)throw new Error("Invalid bill register response.");
  const rows=r.data.map((value:unknown):BillRow=>{const row=record(value,"bill");
    if(row.organization_id!==actor.organizationId||typeof row.state!=="string"||(row.document_number!==null&&typeof row.document_number!=="string")||typeof row.vendor_name!=="string"||(row.invoice_reference!==null&&typeof row.invoice_reference!=="string")||typeof row.issue_date!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(row.issue_date)||(row.due_date!==null&&(typeof row.due_date!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(row.due_date)))||typeof row.total_amount!=="string"||(row.residual_amount!==null&&typeof row.residual_amount!=="string")||typeof row.settlement_status!=="string"||typeof row.duplicate_reference!=="boolean")throw new Error("Invalid bill register row.");
    return{id:parseUuid(row.id),organizationId:parseOrganizationId(row.organization_id),state:row.state,documentNumber:row.document_number,vendorName:row.vendor_name,invoiceReference:row.invoice_reference,issueDate:row.issue_date,dueDate:row.due_date,totalAmount:parseMoneyString(row.total_amount),residualAmount:row.residual_amount===null?null:parseMoneyString(row.residual_amount),settlementStatus:row.settlement_status,duplicateReference:row.duplicate_reference};
  });
  const hasMore=rows.length>input.limit;const items=hasMore?rows.slice(0,input.limit):rows;return{items,nextCursor:hasMore?items.at(-1)?.id??null:null};
}
