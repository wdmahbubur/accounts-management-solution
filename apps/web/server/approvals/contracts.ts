import { parseUuid } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";

export interface SubmitApprovalInput { expectedVersion:number }
export interface SubmitApprovalReceipt { approvalRequestId:string; documentId:string; documentVersion:number; state:"pending"|"approved"; approvalRequired:boolean; policySnapshot:Record<string,unknown> }
export interface ApprovalDecisionInput { decision:"approve"|"reject"; reason:string|null }
export interface ApprovalDecisionReceipt { approvalRequestId:string; state:"pending"|"approved"|"rejected"; decisionId:string; approvedApprovals:number; requiredApprovals:number }
function record(raw:unknown):Record<string,unknown>{if(!raw||typeof raw!=="object"||Array.isArray(raw))throw CommandError.validation({body:"Send a JSON object."});return raw as Record<string,unknown>;}
export function validateSubmitApproval(raw:unknown):SubmitApprovalInput{
  const v=record(raw);if(Object.keys(v).some((key)=>key!=="expected_version"))throw CommandError.validation({body:"Unexpected request field."});
  if(!Number.isSafeInteger(v.expected_version)||Number(v.expected_version)<1)throw CommandError.validation({expected_version:"Refresh the document before submitting it."});
  return{expectedVersion:Number(v.expected_version)};
}
export function validateApprovalDecision(raw:unknown):ApprovalDecisionInput{
  const v=record(raw);if(Object.keys(v).some((key)=>!["decision","reason"].includes(key)))throw CommandError.validation({body:"Unexpected request field."});
  if(v.decision!=="approve"&&v.decision!=="reject")throw CommandError.validation({decision:"Choose approve or reject."});
  const reason=v.reason===undefined||v.reason===null?null:v.reason;if(reason!==null&&(typeof reason!=="string"||reason.trim().length>1000))throw CommandError.validation({reason:"Use up to 1,000 characters."});
  if(v.decision==="reject"&&(!reason||reason.trim().length<10))throw CommandError.validation({reason:"Enter a rejection reason of at least 10 characters."});
  return{decision:v.decision,reason:reason?.trim()??null};
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid approval response.");return value as Record<string,unknown>;}
export function parseSubmitApprovalReceipt(raw:unknown):SubmitApprovalReceipt{
  if(!Array.isArray(raw)||raw.length!==1)throw new Error("Invalid approval submission response.");const v=object(raw[0]);
  if(typeof v.document_version!=="number"||!Number.isSafeInteger(v.document_version)||typeof v.approval_required!=="boolean"||
    (v.state!=="pending"&&v.state!=="approved"))throw new Error("Invalid approval submission response.");
  return{approvalRequestId:parseUuid(v.approval_request_id),documentId:parseUuid(v.document_id),documentVersion:v.document_version,state:v.state,
    approvalRequired:v.approval_required,policySnapshot:object(v.policy_snapshot)};
}
export function parseApprovalDecisionReceipt(raw:unknown):ApprovalDecisionReceipt{
  if(!Array.isArray(raw)||raw.length!==1)throw new Error("Invalid approval decision response.");const v=object(raw[0]);
  if((v.state!=="pending"&&v.state!=="approved"&&v.state!=="rejected")||!Number.isSafeInteger(v.approved_approvals)||!Number.isSafeInteger(v.required_approvals))throw new Error("Invalid approval decision response.");
  return{approvalRequestId:parseUuid(v.approval_request_id),state:v.state,decisionId:parseUuid(v.decision_id),approvedApprovals:Number(v.approved_approvals),requiredApprovals:Number(v.required_approvals)};
}
