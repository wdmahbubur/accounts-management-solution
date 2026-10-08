"use client";
import Link from "next/link";
import { PostingPreview } from "../../../../components/finance/posting-preview.tsx";
import { parsePostingPreviewResult, type PostingPreviewResult } from "../../../../lib/posting-preview.ts";
import { useRef, useState } from "react";
import type { ApprovalInboxState } from "../../../../server/approvals/inbox-service.ts";
import styles from "./approval-inbox.module.css";

type Row=Record<string,unknown>;
type Props={organizationId:string;canDecide:boolean;initialRows:Row[]};
function text(row:Row,key:string,fallback=""){const value=row[key];return typeof value==="string"?value:fallback;}
function obj(value:unknown):Row{return value&&typeof value==="object"&&!Array.isArray(value)?value as Row:{ };}
function date(value:string){const parsed=new Date(value);return Number.isNaN(parsed.valueOf())?value:parsed.toLocaleString();}
const tabs:{value:ApprovalInboxState;label:string}[]=[{value:"pending",label:"Pending"},{value:"approved",label:"Approved"},{value:"rejected",label:"Rejected"},{value:"all",label:"All"}];
export function ApprovalInbox({organizationId,canDecide,initialRows}:Props){
  const [rows,setRows]=useState(initialRows);const [filter,setFilter]=useState<ApprovalInboxState>("pending");const [selected,setSelected]=useState<Row|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [reason,setReason]=useState("");const [preview,setPreview]=useState<PostingPreviewResult|null>(null);const reviewRevision=useRef(0);
  async function load(next:ApprovalInboxState){
    const revision=++reviewRevision.current;setFilter(next);setSelected(null);setPreview(null);setError("");
    try{const response=await fetch(`/api/v1/organizations/${organizationId}/approval-requests?state=${next}`,{cache:"no-store"});const json=await response.json();
      if(!response.ok)throw new Error(json?.error?.message??"Could not load requests.");
      if(revision===reviewRevision.current)setRows(Array.isArray(json.data)?json.data:[]);
    }catch(e){if(revision===reviewRevision.current)setError(e instanceof Error?e.message:"Could not load requests.");}
  }
  async function review(id:string){
    const revision=++reviewRevision.current;setSelected(null);setError("");setReason("");setPreview(null);
    try{const response=await fetch(`/api/v1/organizations/${organizationId}/approval-requests/${id}`,{cache:"no-store"});const json=await response.json();
      if(!response.ok)throw new Error(json?.error?.message??"Could not load review evidence.");
      if(revision===reviewRevision.current)setSelected(obj(json.data));
    }catch(e){if(revision===reviewRevision.current)setError(e instanceof Error?e.message:"Could not load review evidence.");}
  }
  async function decide(decision:"approve"|"reject"){if(!selected)return;setBusy(true);setError("");try{const response=await fetch(`/api/v1/organizations/${organizationId}/approval-requests/${text(selected,"id")}/decision`,{method:"POST",headers:{"Content-Type":"application/json","X-Request-Id":`approval-decision-${crypto.randomUUID()}`,"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({decision,reason:reason.trim()||null})});
      const json=await response.json();if(!response.ok)throw new Error(json?.error?.message??json?.error?.fields?.reason??"Decision could not be recorded.");await load(filter);
    }catch(e){setError(e instanceof Error?e.message:"Decision could not be recorded.");}finally{setBusy(false);}}
  async function showPreview(){
    if(!selected)return;const revision=reviewRevision.current;setBusy(true);setError("");setPreview(null);
    try{const response=await fetch(`/api/v1/organizations/${organizationId}/approval-requests/${text(selected,"id")}/preview`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expected_version:selected.document_version})});
      const json=await response.json();if(!response.ok)throw new Error(json?.error?.message??"Could not create posting preview.");
      if(revision===reviewRevision.current)setPreview(parsePostingPreviewResult(json.data));
    }catch(e){if(revision===reviewRevision.current)setError(e instanceof Error?e.message:"Could not create posting preview.");}finally{setBusy(false);}
  }
  const policy=obj(selected?.policy_snapshot);const document=obj(selected?.document);const attachments=Array.isArray(selected?.attachments)?selected.attachments.map(obj):[];const decisions=Array.isArray(selected?.decisions)?selected.decisions.map(obj):[];
  return <main className={styles.main}><p className="eyebrow">Finance review</p><h1>Approval inbox</h1><p>Review the exact submitted source version, evidence, policy snapshot and calculation preview before deciding.</p>
    <nav className={styles.tabs} aria-label="Approval request status">{tabs.map((tab)=><button key={tab.value} type="button" aria-pressed={filter===tab.value} className={filter===tab.value?styles.active:"secondary"} onClick={()=>void load(tab.value)}>{tab.label}</button>)}</nav>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    <section className={`panel ${styles.panel}`} aria-label="Approval requests">{rows.length===0?<p>No requests in this view.</p>:<div className={styles.tableWrap}><table><thead><tr><th>Type / reference</th><th>Maker</th><th>Amount (BDT)</th><th>Submitted</th><th>Policy progress</th><th>Status</th><th></th></tr></thead><tbody>
      {rows.map((row)=><tr key={text(row,"id")}><td>{text(row,"document_type").replaceAll("_"," ")}<small>{text(row,"document_number",text(row,"description",text(row,"document_id")))}</small></td><td>{text(row,"maker")}</td><td>{text(row,"total_amount")}</td><td>{date(text(row,"created_at"))}</td><td>{Number(row.approved_count??0)} / {Number(policyOf(row).required_approvals??0)} approved</td><td>{row.stale===true?"Changed version":text(row,"state")}</td><td><button type="button" className="secondary" onClick={()=>void review(text(row,"id"))}>Review</button></td></tr>)}
      </tbody></table></div>}</section>
    {selected&&<section className={`panel ${styles.review}`} aria-label="Selected approval review"><div className={styles.reviewHead}><div><p className="eyebrow">{text(selected,"document_type").replaceAll("_"," ")}</p><h2>{text(selected,"document_number",text(selected,"description","Approval request"))}</h2><p>Maker: {text(selected,"maker")} · submitted {date(text(selected,"created_at"))} · BDT {text(selected,"total_amount")}</p></div><Link href={`/o/${organizationId}/accounting/documents/${text(selected,"document_id")}`}>Open source</Link></div>
      {selected.stale===true&&<p role="alert" className={styles.warning}>This approval is stale because the source version or digest changed. It cannot be decided.</p>}
      <div className={styles.grid}><article><h3>Submitted policy</h3><dl><dt>Policy</dt><dd>{text(policy,"policy_name","No approval threshold required")}</dd><dt>Policy version</dt><dd>{text(policy,"policy_version","—")}</dd><dt>Threshold</dt><dd>{text(policy,"threshold_amount","—")}</dd><dt>Required approvals</dt><dd>{text(policy,"required_approvals","0")}</dd><dt>Eligible role</dt><dd>{text(policy,"approver_role_name","—")}</dd><dt>Maker exception</dt><dd>{policy.allow_self_approval===true?"Explicit sole-owner exception":"Disabled"}</dd></dl></article>
        <article><h3>Source lines and terms</h3><pre className={styles.evidence}>{JSON.stringify({trade:document.trade,movement:document.movement,transfer:document.transfer,lines:document.lines,journal_rows:document.journal_rows,allocation_plan:document.allocation_plan},null,2)}</pre></article></div>
      <div className={styles.row}><h3>Attachments</h3>{attachments.length===0?<p>No reviewable attachments.</p>:<ul>{attachments.map((file)=><li key={text(file,"id")}><Link href={`/api/v1/organizations/${organizationId}/attachments/${text(file,"id")}/download`}>{text(file,"filename")}</Link> · {text(file,"scan_status")} · {text(file,"content_type")}</li>)}</ul>}</div>
      <div className={styles.row}><button type="button" className="secondary" disabled={busy||selected.stale===true} onClick={()=>void showPreview()}>{busy?"Working…":"Calculate posting preview"}</button>{preview&&<PostingPreview result={preview}/>}</div>
      <div className={styles.row}><h3>Previous decisions</h3>{decisions.length===0?<p>No decisions recorded.</p>:<ul>{decisions.map((decision)=><li key={text(decision,"id")}>{text(decision,"decision")} by {text(decision,"decided_by")} on {date(text(decision,"decided_at"))}{text(decision,"reason")?` — ${text(decision,"reason")}`:""}</li>)}</ul>}</div>
      {canDecide&&selected.state==="pending"&&<div className={styles.decision}><label>Decision note (required for rejection)<textarea value={reason} maxLength={1000} onChange={(event)=>setReason(event.target.value)}/></label><div className={styles.actions}><button type="button" disabled={busy||selected.stale===true} onClick={()=>void decide("approve")}>Approve</button><button type="button" className="secondary" disabled={busy||selected.stale===true||reason.trim().length<10} onClick={()=>void decide("reject")}>Reject</button></div></div>}
    </section>}
  </main>;
}
function policyOf(row:Row){return obj(row.policy_snapshot);}
