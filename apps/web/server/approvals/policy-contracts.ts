import { parseMoneyString, parseUuid, type MoneyString, type Uuid } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";

export const policyDocumentTypes=["invoice","customer_credit","bill","vendor_credit","paid_expense","receipt","vendor_payment","customer_refund","vendor_refund","customer_advance","vendor_advance","advance_application","transfer","manual_journal","controlled_adjustment","deferred_revenue_release","write_off","opening_balance","year_close","reversal"] as const;
export type PolicyDocumentType=typeof policyDocumentTypes[number];
export interface ApprovalPolicy { id:Uuid; policyGroupId:Uuid; versionNo:number; rowVersion:number; name:string; documentType:PolicyDocumentType; thresholdAmount:MoneyString; approverRoleId:Uuid; approverRoleName:string; requiredApprovals:number; allowSelfApproval:boolean; isActive:boolean; createdAt:string }
export interface ApprovalRole { id:Uuid; name:string; isSystem:boolean }
export interface ApprovalPolicyCatalog { policies:ApprovalPolicy[]; eligibleRoles:ApprovalRole[] }
export interface SaveApprovalPolicyInput { policyId:Uuid|null; expectedVersion:number; name:string; documentType:PolicyDocumentType; thresholdAmount:MoneyString; approverRoleId:Uuid; requiredApprovals:number; allowSelfApproval:boolean; isActive:boolean; reason:string }
export interface SaveApprovalPolicyReceipt extends Omit<ApprovalPolicy,"createdAt"|"policyGroupId"> { policyGroupId:Uuid }
function record(raw:unknown):Record<string,unknown>{if(!raw||typeof raw!=="object"||Array.isArray(raw))throw CommandError.validation({body:"Send a JSON object."});return raw as Record<string,unknown>;}
export function validateSaveApprovalPolicy(raw:unknown):SaveApprovalPolicyInput{
  const v=record(raw);const allowed=["policy_id","expected_version","name","document_type","threshold_amount","approver_role_id","required_approvals","allow_self_approval","is_active","reason"];
  if(Object.keys(v).some((key)=>!allowed.includes(key)))throw CommandError.validation({body:"Unexpected request field."});
  const policyId=v.policy_id===undefined||v.policy_id===null?null:parseUuid(v.policy_id,"policy_id");
  if(!Number.isSafeInteger(v.expected_version)||Number(v.expected_version)<0||(policyId===null?Number(v.expected_version)!==0:Number(v.expected_version)<1))throw CommandError.validation({expected_version:"Refresh the latest policy version before saving."});
  if(typeof v.name!=="string"||v.name.trim().length<1||v.name.trim().length>120)throw CommandError.validation({name:"Use a policy name of 1–120 characters."});
  if(typeof v.document_type!=="string"||!policyDocumentTypes.includes(v.document_type as PolicyDocumentType))throw CommandError.validation({document_type:"Choose a supported document type."});
  const thresholdAmount=parseMoneyString(v.threshold_amount,"threshold_amount");
  if(BigInt(thresholdAmount.replace(".",""))<0n)throw CommandError.validation({threshold_amount:"Threshold cannot be negative."});
  const requiredApprovals=v.required_approvals;if(!Number.isSafeInteger(requiredApprovals)||Number(requiredApprovals)<1||Number(requiredApprovals)>5)throw CommandError.validation({required_approvals:"Choose 1–5 approvers."});
  if(typeof v.allow_self_approval!=="boolean"||typeof v.is_active!=="boolean")throw CommandError.validation({body:"Choose explicit policy settings."});
  if(typeof v.reason!=="string"||v.reason.trim().length<10||v.reason.trim().length>1000)throw CommandError.validation({reason:"Enter a reason of 10–1,000 characters."});
  return{policyId,expectedVersion:Number(v.expected_version),name:v.name.trim(),documentType:v.document_type as PolicyDocumentType,thresholdAmount,
    approverRoleId:parseUuid(v.approver_role_id,"approver_role_id"),requiredApprovals:Number(requiredApprovals),allowSelfApproval:v.allow_self_approval,isActive:v.is_active,reason:v.reason.trim()};
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid approval policy response.");return value as Record<string,unknown>;}
function integer(value:unknown){if(typeof value!=="number"||!Number.isSafeInteger(value))throw new Error("Invalid approval policy version.");return value;}
export function parseApprovalPolicyList(raw:unknown):ApprovalPolicy[]{
  if(!Array.isArray(raw))throw new Error("Invalid approval policy list.");return raw.map((item)=>{const r=object(item);
    if(typeof r.name!=="string"||typeof r.document_type!=="string"||!policyDocumentTypes.includes(r.document_type as PolicyDocumentType)||
      typeof r.approver_role_name!=="string"||typeof r.allow_self_approval!=="boolean"||typeof r.is_active!=="boolean"||typeof r.created_at!=="string")throw new Error("Invalid approval policy row.");
    return{id:parseUuid(r.id),policyGroupId:parseUuid(r.policy_group_id),versionNo:integer(r.version_no),rowVersion:integer(r.row_version),name:r.name,
      documentType:r.document_type as PolicyDocumentType,thresholdAmount:parseMoneyString(r.threshold_amount),approverRoleId:parseUuid(r.approver_role_id),
      approverRoleName:r.approver_role_name,requiredApprovals:integer(r.required_approvals),allowSelfApproval:r.allow_self_approval,isActive:r.is_active,createdAt:r.created_at};
  });
}
export function parseApprovalRoleList(raw:unknown):ApprovalRole[]{
  if(!Array.isArray(raw))throw new Error("Invalid approval role list.");return raw.map((item)=>{const r=object(item);if(typeof r.role_name!=="string"||typeof r.is_system!=="boolean")throw new Error("Invalid approval role.");return{id:parseUuid(r.role_id),name:r.role_name,isSystem:r.is_system};});
}
export function parseSaveApprovalPolicy(raw:unknown):SaveApprovalPolicyReceipt{
  if(!Array.isArray(raw)||raw.length!==1)throw new Error("Invalid approval policy receipt.");const r=object(raw[0]);
  if(typeof r.name!=="string"||typeof r.document_type!=="string"||!policyDocumentTypes.includes(r.document_type as PolicyDocumentType)||typeof r.approver_role_name!=="string"||
    typeof r.allow_self_approval!=="boolean"||typeof r.is_active!=="boolean")throw new Error("Invalid approval policy receipt.");
  return{id:parseUuid(r.policy_id),policyGroupId:parseUuid(r.policy_group_id),versionNo:integer(r.version_no),rowVersion:integer(r.row_version),name:r.name,
    documentType:r.document_type as PolicyDocumentType,thresholdAmount:parseMoneyString(r.threshold_amount),approverRoleId:parseUuid(r.approver_role_id),
    approverRoleName:r.approver_role_name,requiredApprovals:integer(r.required_approvals),allowSelfApproval:r.allow_self_approval,isActive:r.is_active};
}
