"use client";
import { useMemo, useState, type FormEvent } from "react";
import type { ApprovalPolicy, ApprovalPolicyCatalog, PolicyDocumentType } from "../../../../../server/approvals/policy-contracts.ts";
import { policyDocumentTypes } from "../../../../../server/approvals/policy-contracts.ts";
import styles from "./approval-settings.module.css";

type Props={organizationId:string;nonce:string;catalog:ApprovalPolicyCatalog};
function title(value:string){return value.split("_").map((part)=>part[0]?.toUpperCase()+part.slice(1)).join(" ");}
export function ApprovalSettings({organizationId,nonce,catalog}:Props){
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
  const [base,setBase]=useState<ApprovalPolicy|null>(null);const [name,setName]=useState("");const [documentType,setDocumentType]=useState<PolicyDocumentType>("receipt");
  const [threshold,setThreshold]=useState("0.00");const [roleId,setRoleId]=useState<string>(catalog.eligibleRoles[0]?.id??"");const [required,setRequired]=useState("1");
  const [allowSelf,setAllowSelf]=useState(false);const [active,setActive]=useState(true);const [reason,setReason]=useState("");
  const latest=useMemo(()=>{const groups=new Map<string,ApprovalPolicy>();for(const policy of catalog.policies){const known=groups.get(policy.policyGroupId);if(!known||policy.versionNo>known.versionNo)groups.set(policy.policyGroupId,policy);}return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));},[catalog.policies]);
  function reset(){setBase(null);setName("");setDocumentType("receipt");setThreshold("0.00");setRoleId(catalog.eligibleRoles[0]?.id??"");setRequired("1");setAllowSelf(false);setActive(true);setReason("");}
  function edit(policy:ApprovalPolicy){setBase(policy);setName(policy.name);setDocumentType(policy.documentType);setThreshold(policy.thresholdAmount);setRoleId(policy.approverRoleId);setRequired(String(policy.requiredApprovals));setAllowSelf(policy.allowSelfApproval);setActive(true);setReason("");}
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError("");setMessage("");
    try{const response=await fetch(`/api/v1/organizations/${organizationId}/approval-policies`,{method:"POST",headers:{"Content-Type":"application/json","X-Request-Id":`approval-policy-${crypto.randomUUID()}`,"Idempotency-Key":crypto.randomUUID()},
      body:JSON.stringify({policy_id:base?.id??null,expected_version:base?.rowVersion??0,name,document_type:documentType,threshold_amount:threshold,approver_role_id:roleId,
        required_approvals:Number(required),allow_self_approval:allowSelf,is_active:active,reason})});const json=await response.json();
      if(!response.ok)throw new Error(json?.error?.fields?.policy??json?.error?.fields?.reason??json?.error?.message??"Could not save approval policy.");
      setMessage("Policy version saved. Refreshing the current company configuration.");window.location.reload();
    }catch(caught){setError(caught instanceof Error?caught.message:"Could not save approval policy.");}finally{setBusy(false);}}
  async function archive(policy:ApprovalPolicy){setBase(policy);setName(policy.name);setDocumentType(policy.documentType);setThreshold(policy.thresholdAmount);setRoleId(policy.approverRoleId);
    setRequired(String(policy.requiredApprovals));setAllowSelf(policy.allowSelfApproval);setActive(false);setReason("Company retired this approval policy version.");
    setError("");setMessage("");setBusy(true);
    try{const response=await fetch(`/api/v1/organizations/${organizationId}/approval-policies`,{method:"POST",headers:{"Content-Type":"application/json","X-Request-Id":`approval-policy-${crypto.randomUUID()}`,"Idempotency-Key":crypto.randomUUID()},
      body:JSON.stringify({policy_id:policy.id,expected_version:policy.rowVersion,name:policy.name,document_type:policy.documentType,threshold_amount:policy.thresholdAmount,
        approver_role_id:policy.approverRoleId,required_approvals:policy.requiredApprovals,allow_self_approval:policy.allowSelfApproval,is_active:false,reason:"Company retired this approval policy version."})});
      const json=await response.json();if(!response.ok)throw new Error(json?.error?.fields?.policy??json?.error?.message??"Could not archive policy.");setMessage("Policy archived in a new version. Refreshing.");window.location.reload();
    }catch(caught){setError(caught instanceof Error?caught.message:"Could not archive policy.");}finally{setBusy(false);}}
  return <main className={styles.main} data-company-context={nonce}>
    <p className="eyebrow">Company settings</p><h1>Approval policies</h1>
    <aside className={styles.notice}><strong>Versioned controls</strong><p>Changes create a new policy version. Existing approval requests keep their policy snapshot and become stale when that policy is changed. The highest active threshold at or below a document total applies; equal thresholds are rejected. A total below all active thresholds follows the policy&apos;s no-approval path.</p>
      <p>Self approval can be enabled only for a sole active owner, and the decision command checks that condition again.</p></aside>
    {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status">{message}</p>}
    <section className={`panel ${styles.panel}`}><h2>{base?`Create version ${base.versionNo+1} of ${base.name}`:"Create approval policy"}</h2>
      <form className={styles.form} onSubmit={save}>
        <label>Policy name<input required maxLength={120} value={name} onChange={(event)=>setName(event.target.value)}/></label>
        <label>Document type<select value={documentType} onChange={(event)=>setDocumentType(event.target.value as PolicyDocumentType)}>{policyDocumentTypes.map((kind)=><option key={kind} value={kind}>{title(kind)}</option>)}</select></label>
        <label>Approval threshold (BDT)<input required inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,2})?" value={threshold} onChange={(event)=>setThreshold(event.target.value)}/></label>
        <label>Approver role<select required value={roleId} onChange={(event)=>setRoleId(event.target.value)}><option value="">Choose an eligible role</option>{catalog.eligibleRoles.map((role)=><option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
        <label>Required approvals<select value={required} onChange={(event)=>setRequired(event.target.value)}>{[1,2,3,4,5].map((count)=><option key={count} value={count}>{count}</option>)}</select></label>
        <label className={styles.check}><input type="checkbox" checked={allowSelf} onChange={(event)=>setAllowSelf(event.target.checked)}/>Allow sole-owner self approval</label>
        <label className={styles.check}><input type="checkbox" checked={active} onChange={(event)=>setActive(event.target.checked)}/>Policy version active</label>
        <label className={styles.wide}>Reason for this policy version<textarea required minLength={10} maxLength={1000} value={reason} onChange={(event)=>setReason(event.target.value)}/></label>
        <div className={styles.actions}><button type="submit" disabled={busy||catalog.eligibleRoles.length===0}>{busy?"Saving…":base?"Save new version":"Create policy"}</button>{base&&<button type="button" className="secondary" disabled={busy} onClick={reset}>Cancel version</button>}</div>
      </form>
      {catalog.eligibleRoles.length===0&&<p>No roles currently have the approval decision capability. Assign an eligible role before creating a policy.</p>}
    </section>
    <section className={`panel ${styles.panel}`}><h2>Policy history</h2>
      {catalog.policies.length===0?<p>No approval policies are configured. Documents that require an approval policy remain blocked until one is added.</p>:<div className={styles.tableWrap}><table><thead><tr><th>Name/version</th><th>Document</th><th>Threshold</th><th>Approver</th><th>Required</th><th>Self approval</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {catalog.policies.map((policy)=><tr key={policy.id}><td>{policy.name} · v{policy.versionNo}</td><td>{title(policy.documentType)}</td><td>{policy.thresholdAmount}</td><td>{policy.approverRoleName}</td><td>{policy.requiredApprovals}</td><td>{policy.allowSelfApproval?"Sole active owner":"Disabled"}</td><td>{policy.isActive?"Active":"Archived"}</td><td>{latest.find((row)=>row.policyGroupId===policy.policyGroupId)?.id===policy.id&&<div className={styles.rowActions}><button type="button" className="secondary" disabled={busy} onClick={()=>edit(policy)}>New version</button>{policy.isActive&&<button type="button" className="secondary" disabled={busy} onClick={()=>void archive(policy)}>Archive</button>}</div>}</td></tr>)}
      </tbody></table></div>}
    </section>
  </main>;
}
