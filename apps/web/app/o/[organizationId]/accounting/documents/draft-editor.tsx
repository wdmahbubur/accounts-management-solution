"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ContractValidationError } from "@ams/contracts";
import { displayMoney } from "../../../../../components/finance/contracts.ts";
import { useRouter } from "next/navigation";
import type { SourceType } from "../../../../../server/documents/contracts.ts";
import { bangladeshDate } from "../../../../../lib/date.ts";
import { PostingPreview } from "../../../../../components/finance/posting-preview.tsx";
import { parsePostingPreviewResult, type PostingPreviewResult } from "../../../../../lib/posting-preview.ts";
import { DraftEditGuard } from "./draft-interactions.ts";
import { calculateTradeDraft, canonicalAmountInput, type SavedLineTax } from "./draft-calculations.ts";
import { confirmedDraftReceipt, documentActionError, isConfirmedFormRejection, RecoverableFormRequest } from "./document-action-validation.ts";
import styles from "./documents.module.css";

type Option={id:string;code?:string;name?:string;display_name?:string;kind?:string;label?:string;rate_percent?:string};
type ItemOption={id:string;sku:string|null;name:string;unit:string;default_unit_price:string;sales_account_id:string|null;purchase_account_id:string|null;tax_code_id:string|null};
export type DraftOptions={accounts:Option[];parties:Option[];cash_accounts:Option[];rounding_accounts:Option[];tax_codes:Option[];items:ItemOption[];cost_centers:Option[]};
type Line={uiKey:string;id:string|null;item_id:string|null;item_snapshot:Record<string,unknown>|null;original_line_id:string|null;description:string;quantity:string;unit_price:string;discount_amount:string;account_id:string;cost_center_id:string|null;cost_center_snapshot:Record<string,unknown>|null;tax_code_id:string|null;tax_mode:"exclusive"|"inclusive"};
type Journal={account_id:string;cost_center_id:string|null;debit:string;credit:string;description:string;cash_flow_class:string};
type Movement={cash_account_id:string;direction:"in"|"out";amount:string;method:string;reference:string;cash_flow_class:string};
type Plan={target_open_item_id:string;amount:string};
type ReceiptTarget={openItemId:string;documentId:string;documentNumber:string|null;issueDate:string;dueDate:string|null;totalAmount:string;residualAmount:string};
const labels:Record<SourceType,string>={invoice:"Sales invoice",customer_credit:"Customer credit",bill:"Supplier bill",vendor_credit:"Supplier credit",paid_expense:"Paid expense",receipt:"Customer receipt",vendor_payment:"Supplier payment",customer_refund:"Customer refund",vendor_refund:"Supplier refund",customer_advance:"Customer advance",vendor_advance:"Supplier advance",transfer:"Cash transfer",manual_journal:"Manual journal",controlled_adjustment:"Controlled adjustment",opening_balance:"Opening balance"};
const tradeTypes:SourceType[]=["invoice","customer_credit","bill","vendor_credit","paid_expense"];
const movementTypes:SourceType[]=["receipt","vendor_payment","customer_refund","vendor_refund","customer_advance","vendor_advance","paid_expense"];
const journalTypes:SourceType[]=["manual_journal","controlled_adjustment","opening_balance"];
const blankLine=(accountId="",uiKey=""):Line=>({uiKey,id:null,item_id:null,item_snapshot:null,original_line_id:null,description:"",quantity:"1",unit_price:"0.00",discount_amount:"0.00",account_id:accountId,cost_center_id:null,cost_center_snapshot:null,tax_code_id:null,tax_mode:"exclusive"});
export function DraftEditor({organizationId,nonce,documentType,options,initial,expectedVersion,duplicate=false,createNew=false,receiptInvoices=[],receiptInvoiceError="",defaultDate}:{organizationId:string;nonce:string;documentType:SourceType;options:DraftOptions;initial?:Record<string,unknown>;expectedVersion?:number;duplicate?:boolean;createNew?:boolean;receiptInvoices?:ReceiptTarget[];receiptInvoiceError?:string;defaultDate?:string}){
 const router=useRouter();
 const editorId=useId();
 const formRef=useRef<HTMLFormElement>(null);
 const errorRef=useRef<HTMLDivElement>(null);
 const lineSequence=useRef(0);
 const saveRequest=useRef(new RecoverableFormRequest());
 const submitIdem=useRef<string>(crypto.randomUUID());
 const [action,setAction]=useState<"save"|"preview"|"submit"|null>(null);
 const busy=action!==null;
 const [error,setError]=useState("");
 const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
 const [conflict,setConflict]=useState(false);
 const [retrySave,setRetrySave]=useState(false);
 const [preview,setPreview]=useState<PostingPreviewResult|null>(null);
 const guard=useRef(new DraftEditGuard());
 const requestPending=useRef(false);
 const [dirty,setDirty]=useState(false);
 const [savedVersion,setSavedVersion]=useState<number>();
 const [today]=useState(()=>defaultDate??bangladeshDate());
 const dirtyMessageId=`${editorId}-dirty`;
 const version=savedVersion??expectedVersion;
 useEffect(()=>{
  if(!dirty&&!retrySave)return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
  window.addEventListener("beforeunload",warn);
  return()=>window.removeEventListener("beforeunload",warn);
 },[dirty,retrySave]);
 function focusError(){requestAnimationFrame(()=>errorRef.current?.focus());}
 function focusField(name:string){
  const control=formRef.current?.elements.namedItem(name);
  if(control instanceof HTMLElement){
   let parent=control.parentElement;
   while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
   control.focus();
  }
 }
 function markDirty(){guard.current.markChanged();setDirty(true);setPreview(null);setFieldErrors({});}
 function beginReview(nextAction:"preview"|"submit"){
  if(!initial||createNew||requestPending.current||retrySave)return false;
  if(!guard.current.canReview()){setError("Save your changes before previewing or submitting this draft.");focusError();return false;}
  requestPending.current=true;setAction(nextAction);setError("");setFieldErrors({});return true;
 }
 function finishRequest(){requestPending.current=false;setAction(null);}
 const d=initial??{};const initialLines=Array.isArray(d.lines)?d.lines as Record<string,unknown>[]:[];
 const [lines,setLines]=useState<Line[]>(initialLines.length?initialLines.map((l,i)=>({uiKey:`${editorId}-saved-${i}`,id:l.id?String(l.id):null,item_id:l.item_id?String(l.item_id):null,item_snapshot:l.item_snapshot&&typeof l.item_snapshot==="object"?l.item_snapshot as Record<string,unknown>:null,original_line_id:l.original_line_id?String(l.original_line_id):null,description:String(l.description),quantity:String(l.quantity),unit_price:String(l.unit_price),discount_amount:String(l.discount_amount),account_id:String(l.account_id),cost_center_id:l.cost_center_id?String(l.cost_center_id):null,cost_center_snapshot:l.cost_center_snapshot&&typeof l.cost_center_snapshot==="object"?l.cost_center_snapshot as Record<string,unknown>:null,tax_code_id:l.tax_code_id?String(l.tax_code_id):null,tax_mode:l.tax_mode==="inclusive"?"inclusive":"exclusive"})): [blankLine(options.accounts[0]?.id,`${editorId}-first`)]);
 const [journals,setJournals]=useState<Journal[]>(Array.isArray(d.journal_rows)?(d.journal_rows as Record<string,unknown>[]).map((r)=>({account_id:String(r.account_id),cost_center_id:r.cost_center_id?String(r.cost_center_id):null,debit:String(r.debit),credit:String(r.credit),description:String(r.description),cash_flow_class:String(r.cash_flow_class??"unclassified")})): [{account_id:options.accounts[0]?.id??"",cost_center_id:null,debit:"0.00",credit:"0.00",description:"",cash_flow_class:"unclassified"}]);
 const [movement,setMovement]=useState<Movement>(()=>{const m=(d.movement&&typeof d.movement==="object"?d.movement:{}) as Record<string,unknown>;return{cash_account_id:String(m.cash_account_id??options.cash_accounts[0]?.id??""),direction:String(m.direction??(["receipt","customer_advance","vendor_refund"].includes(documentType)?"in":"out")) as "in"|"out",amount:String(m.amount??"0.00"),method:String(m.method??"bank_transfer"),reference:String(m.reference??""),cash_flow_class:String(m.cash_flow_class??"unclassified")};});
 const [allocationPlan,setAllocationPlan]=useState<Plan[]>(Array.isArray(d.allocation_plan)?(d.allocation_plan as Record<string,unknown>[]).map((p)=>({target_open_item_id:String(p.target_open_item_id),amount:String(p.amount)})):[]);
 const [trade,setTrade]=useState<Record<string,unknown>>(()=>d.trade&&typeof d.trade==="object"?d.trade as Record<string,unknown>:{recognition_mode:"earned_or_incurred",performance_confirmed:false});
 const [transfer,setTransfer]=useState<Record<string,string>>(()=>{const t=(d.transfer&&typeof d.transfer==="object"?d.transfer:{}) as Record<string,unknown>;return{from_cash_account_id:String(t.from_cash_account_id??options.cash_accounts[0]?.id??""),to_cash_account_id:String(t.to_cash_account_id??options.cash_accounts[1]?.id??""),amount:String(t.amount??"0.00"),fee_amount:String(t.fee_amount??"0.00"),fee_account_id:String(t.fee_account_id??options.accounts[0]?.id??"")};});
 const field=(name:string,fallback="")=>String(d[name]??fallback);
 const [issueDate,setIssueDate]=useState(field("issue_date",today));
 const [rounding,setRounding]=useState({amount:field("rounding_adjustment","0.00"),reason:field("rounding_reason"),accountId:field("rounding_account_id")});
 const isTrade=tradeTypes.includes(documentType);
 const isCredit=documentType==="customer_credit"||documentType==="vendor_credit";
 const savedTaxes:SavedLineTax[]=initialLines.filter(line=>typeof line.tax_rate_snapshot==="string").map(line=>({
  id:line.id?String(line.id):null,original_line_id:line.original_line_id?String(line.original_line_id):null,
  tax_code_id:line.tax_code_id?String(line.tax_code_id):null,tax_rate_snapshot:String(line.tax_rate_snapshot),tax_mode:line.tax_mode==="inclusive"?"inclusive":"exclusive"
 }));
 const liveTotals=isTrade?calculateTradeDraft({lines,taxCodes:options.tax_codes,savedLines:savedTaxes,credit:isCredit,rounding}):null;
 const issueMessage=(name:string)=>fieldErrors[name]??liveTotals?.issues.find(issue=>issue.field===name)?.message;
 const fieldAttributes=(name:string)=>({name,"aria-invalid":Boolean(issueMessage(name)),"aria-describedby":issueMessage(name)?`${editorId}-${name}-error`:undefined});
 const fieldError=(name:string)=>issueMessage(name)?<small className={styles.fieldError} id={`${editorId}-${name}-error`}>{issueMessage(name)}</small>:null;
 function updateLine(index:number,changes:Partial<Line>){setLines(current=>current.map((line,i)=>i===index?{...line,...changes}:line));}
 function normalizeAmount(value:string,name:string,allowNegative=false){
  try{return canonicalAmountInput(value,allowNegative);}
  catch{throw new ContractValidationError("Check the highlighted amounts.",{[name]:"Enter an amount with up to two decimal places, for example 1250.00."});}
 }
 const [receiptParty,setReceiptParty]=useState(field("party_id"));const [receiptDate,setReceiptDate]=useState(field("accounting_date",today));
 const [receiptTargets,setReceiptTargets]=useState<ReceiptTarget[]>(receiptInvoices);const [receiptLoading,setReceiptLoading]=useState(false);
 const [receiptError,setReceiptError]=useState(receiptInvoiceError);const receiptRequest=useRef(0);
 async function refreshReceiptTargets(partyId:string,date:string){
  const request=++receiptRequest.current;setReceiptTargets([]);setReceiptError("");
  if(!partyId||!date){setReceiptLoading(false);return;}setReceiptLoading(true);
  try{
   const q=new URLSearchParams({party_id:partyId,accounting_date:date});
   const response=await fetch(`/api/v1/organizations/${organizationId}/receipt-allocation-options?${q}`,{cache:"no-store"});
   const json=await response.json();if(!response.ok)throw new Error(json?.error?.message??"Eligible invoices could not be loaded.");
   if(!Array.isArray(json.data))throw new Error("Eligible invoices could not be loaded.");
   if(request===receiptRequest.current)setReceiptTargets(json.data as ReceiptTarget[]);
  }catch(e){if(request===receiptRequest.current)setReceiptError(e instanceof Error?e.message:"Eligible invoices could not be loaded.");}
  finally{if(request===receiptRequest.current)setReceiptLoading(false);}
 }

 async function submit(form:FormData){
  if(requestPending.current)return;
  let attempt;
  try{
   if(!retrySave&&liveTotals?.issues.length){
    setFieldErrors(Object.fromEntries(liveTotals.issues.map(issue=>[issue.field,issue.message])));
    setError("Check the highlighted values before saving.");focusError();return;
   }
   if(retrySave){attempt=saveRequest.current.begin("");}
   else{
    const roundingAdjustment=normalizeAmount(rounding.amount,"rounding_adjustment",true);
    const payload={
     document_type:documentType,party_id:String(form.get("party_id")??"")||null,
     issue_date:String(form.get("issue_date")??""),accounting_date:String(form.get("accounting_date")??""),
     due_date:String(form.get("due_date")??"")||null,external_reference:String(form.get("external_reference")??"")||null,
     description:String(form.get("description")??""),currency:"BDT",rounding_adjustment:roundingAdjustment,
     rounding_reason:roundingAdjustment==="0.00"?null:rounding.reason,
     rounding_account_id:roundingAdjustment==="0.00"?null:rounding.accountId||null,
     trade:isTrade?{...trade,original_document_id:String(form.get("original_document_id")??"")||null,
      supplier_invoice_date:String(form.get("supplier_invoice_date")??"")||null,supplier_invoice_key:String(form.get("supplier_invoice_key")??"")||null}:null,
     movement:movementTypes.includes(documentType)?{...movement,amount:normalizeAmount(movement.amount,"amount")}:null,
     transfer:documentType==="transfer"?{...transfer,amount:normalizeAmount(transfer.amount,"amount"),fee_amount:normalizeAmount(transfer.fee_amount,"fee_amount")}:null,
     lines:isTrade?lines.map((line,i)=>{
      const payloadLine:Record<string,unknown>={...line,discount_amount:normalizeAmount(line.discount_amount,`lines.${i+1}.discount_amount`)};
      delete payloadLine.uiKey;delete payloadLine.item_snapshot;delete payloadLine.cost_center_snapshot;return payloadLine;
     }):[],
     journal_rows:journalTypes.includes(documentType)?journals.map((row,i)=>({...row,debit:normalizeAmount(row.debit,`journal_rows.${i+1}.debit`),credit:normalizeAmount(row.credit,`journal_rows.${i+1}.credit`)})):[],
     allocation_plan:allocationPlan.filter(plan=>plan.target_open_item_id.trim()&&!/^0+(?:\.0+)?$/.test(plan.amount.trim()))
      .map((plan,i)=>({...plan,amount:normalizeAmount(plan.amount,`allocation_plan.${i+1}.amount`)}))
    };
    const editing=!!initial&&!createNew;
    attempt=saveRequest.current.begin(JSON.stringify(editing?{expected_version:version,draft:payload}:payload),guard.current.revision);
   }
  }catch(failure){
   setError(failure instanceof Error?failure.message:"Check the draft values.");
   if(failure instanceof ContractValidationError)setFieldErrors({...failure.fields});
   focusError();return;
  }
  if(!attempt)return;
  requestPending.current=true;setAction("save");setError("");setFieldErrors({});setConflict(false);
  try{
   const editing=!!initial&&!createNew;
   const response=await fetch(`/api/v1/organizations/${organizationId}/documents${editing?`/${String(d.id)}`:""}`,{
    method:editing?"PATCH":"POST",headers:{"Content-Type":"application/json","X-Request-Id":`document-${crypto.randomUUID()}`,"Idempotency-Key":attempt.key},body:attempt.body
   });
   const json=await response.json();
   if(!response.ok){
    if(isConfirmedFormRejection(response.status,json))saveRequest.current.rejected();
    const failure=documentActionError(json,"Could not save the draft.");
    setFieldErrors(failure.fields);setConflict(failure.code==="STALE_VERSION");throw new Error(failure.message);
   }
   const receipt=confirmedDraftReceipt(json.data,editing?String(d.id):undefined);
   saveRequest.current.confirmed();setRetrySave(false);setSavedVersion(receipt.documentVersion);
   setDirty(!guard.current.confirmSaved(attempt.revision));setPreview(null);
   router.push(`/o/${organizationId}/accounting/documents/${receipt.documentId}`);router.refresh();
  }catch(failure){
   saveRequest.current.uncertain();setRetrySave(saveRequest.current.needsRetry);
   setError(failure instanceof Error?failure.message:"Could not save the draft.");focusError();
  }finally{finishRequest();}
 }
 async function previewPosting(){
  if(!beginReview("preview"))return;
  const reviewedRevision=guard.current.revision;setPreview(null);
  try{
   const response=await fetch(`/api/v1/organizations/${organizationId}/documents/${String(d.id)}/preview-posting`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expected_version:version})});
   const json=await response.json();if(!response.ok){const failure=documentActionError(json,"Could not preview the draft.");setFieldErrors(failure.fields);throw new Error(failure.message);}
   if(guard.current.canReview(reviewedRevision))setPreview(parsePostingPreviewResult(json.data));
  }catch(e){setError(e instanceof Error?e.message:"Could not preview draft.");focusError();}finally{finishRequest();}
 }
 async function submitForApproval(){
  if(!beginReview("submit"))return;
  try{
   const response=await fetch(`/api/v1/organizations/${organizationId}/documents/${String(d.id)}/submit`,{method:"POST",headers:{"Content-Type":"application/json","X-Request-Id":`document-submit-${crypto.randomUUID()}`,"Idempotency-Key":submitIdem.current},body:JSON.stringify({expected_version:version})});
   const json=await response.json();if(!response.ok){const failure=documentActionError(json,"Could not submit the document for review.");setFieldErrors(failure.fields);throw new Error(failure.message);}
   submitIdem.current=crypto.randomUUID();router.refresh();
  }catch(e){setError(e instanceof Error?e.message:"Could not submit document for review.");focusError();}finally{finishRequest();}
 }
 const needsParty=documentType!=="paid_expense"&&["invoice","customer_credit","bill","vendor_credit","receipt","vendor_payment","customer_refund","vendor_refund","customer_advance","vendor_advance"].includes(documentType);
 const partyLabel=["bill","vendor_credit","vendor_payment","vendor_refund","vendor_advance"].includes(documentType)?"Supplier":"Customer";
 const Heading=initial&&!createNew?"h2":"h1";
 const decimalPattern="(0|[1-9][0-9]{0,13})([.][0-9]{1,6})?";
 const moneyPattern="(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?";
 function errorLabel(name:string){
  const fields:Record<string,string>={party_id:partyLabel,issue_date:"Issue date",accounting_date:"Accounting date",due_date:"Due date",description:"Description",quantity:"Quantity",unit_price:"Unit price",discount_amount:"Discount",account_id:"Account",rounding_adjustment:"Rounding adjustment",rounding_reason:"Rounding reason",rounding_account_id:"Rounding account",expected_version:"Saved version",notes:"Invoice notes",terms:"Payment terms"};
  const line=name.match(/^lines\.(\d+)\.(.+)$/);
  return line?`Line ${line[1]} · ${fields[line[2]!]??line[2]!.replaceAll("_"," ")}`:fields[name]??name.replaceAll("_"," ").replaceAll("."," · ");
 }
 return <section className={`${styles.main} ${styles.editor}`} data-company-context={nonce} aria-labelledby={`${editorId}-heading`}>
  <header className={styles.editorHeader}>
   {(!initial||createNew)&&<p className="eyebrow">{duplicate?"Copy as a new draft":"Draft"} · BDT</p>}
   <Heading id={`${editorId}-heading`}>{initial&&!createNew?`Edit ${labels[documentType].toLowerCase()}`:`${duplicate?"Duplicate · ":"New "}${labels[documentType]}`}</Heading>
   <p className={styles.hint}>Save your draft, check the saved preview, then submit it for approval. Saving a draft does not post to your books.</p>
  </header>
  {error&&<div ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>
   <strong>{error}</strong>
   {Object.keys(fieldErrors).length>0&&<ul>{Object.entries(fieldErrors).map(([name,message])=><li key={name}>
    <button type="button" className={styles.errorLink} onClick={()=>focusField(name)}>{errorLabel(name)}: {message}</button>
   </li>)}</ul>}
   {conflict&&<p>Your entries are still here. Open the <a href={`/o/${organizationId}/accounting/documents/${String(d.id)}`} target="_blank" rel="noreferrer">current saved version in another tab</a> to compare changes before reloading this form.</p>}
  </div>}
  {retrySave&&<p role="status" className={styles.recovery}>The save result is unconfirmed. Your submitted values are kept unchanged. Use “Retry save” to confirm the same request before editing or submitting for approval.</p>}
  <form ref={formRef} className={styles.editorForm} aria-busy={busy}
   onChange={markDirty}
   onClickCapture={event=>{if(event.target instanceof Element&&event.target.closest('button[data-draft-edit="true"]'))markDirty();}}
   onInvalidCapture={event=>{
    const control=event.target;
    if((control instanceof HTMLInputElement||control instanceof HTMLSelectElement||control instanceof HTMLTextAreaElement)&&control.name){
     setError("Check the highlighted fields before saving.");setFieldErrors(current=>({...current,[control.name]:control.validationMessage}));
    }
   }}
   onSubmit={event=>{event.preventDefault();void submit(new FormData(event.currentTarget));}}>
   <fieldset disabled={busy||retrySave} className={`${styles.form} ${styles.editorFields}`}>
    <section className={`${styles.wide} ${styles.editorSection}`} aria-labelledby={`${editorId}-details`}>
     <h2 id={`${editorId}-details`}>Document details</h2>
     <div className={styles.editorGrid}>
      {needsParty&&<label>{partyLabel}
       <select {...fieldAttributes("party_id")} required value={documentType==="receipt"?receiptParty:undefined}
        defaultValue={documentType==="receipt"?undefined:field("party_id")}
        onChange={documentType==="receipt"?event=>{const party=event.target.value;setReceiptParty(party);setAllocationPlan([]);void refreshReceiptTargets(party,receiptDate);}:undefined}>
        <option value="">Choose a {partyLabel.toLowerCase()}</option>
        {field("party_id")&&!options.parties.some(p=>p.id===field("party_id"))&&<option value={field("party_id")}>Saved {partyLabel.toLowerCase()} · not in the active list</option>}
        {options.parties.map(p=><option key={p.id} value={p.id}>{p.display_name}</option>)}
       </select>{fieldError("party_id")}
       {options.parties.length===0&&<small>No active {partyLabel.toLowerCase()} is available. Add one in {partyLabel==="Customer"?"Sales → Customers":"Purchases → Vendors"} before saving.</small>}
      </label>}
      <label>Issue date<input {...fieldAttributes("issue_date")} type="date" required value={issueDate} onChange={event=>setIssueDate(event.target.value)}/>{fieldError("issue_date")}</label>
      <label>Accounting date<input {...fieldAttributes("accounting_date")} type="date" required value={documentType==="receipt"?receiptDate:undefined}
       defaultValue={documentType==="receipt"?undefined:field("accounting_date",today)}
       onChange={documentType==="receipt"?event=>{const date=event.target.value;setReceiptDate(date);setAllocationPlan([]);void refreshReceiptTargets(receiptParty,date);}:undefined}/>{fieldError("accounting_date")}</label>
      <label><span>Due date <span className={styles.optional}>Optional</span></span><input {...fieldAttributes("due_date")} type="date" min={issueDate} defaultValue={field("due_date")}/>{fieldError("due_date")}</label>
      <label><span>Reference <span className={styles.optional}>Optional</span></span><input {...fieldAttributes("external_reference")} maxLength={160} defaultValue={field("external_reference")} placeholder="PO number or your reference"/>{fieldError("external_reference")}</label>
      <label><span>Description <span className={styles.optional}>Optional</span></span><input {...fieldAttributes("description")} maxLength={2000} defaultValue={field("description")} placeholder="What is this document for?"/>{fieldError("description")}</label>
     </div>
     <p className={styles.hint}>The issue date appears on the document. The accounting date determines when it is recorded in the books.</p>
    </section>
    {isTrade&&<>
     {(isCredit||documentType==="invoice"||documentType==="bill")&&<section className={`${styles.wide} ${styles.editorSection}`}>
      <h2>{documentType==="invoice"?"Service and payment details":isCredit?"Original document":"Supplier invoice"}</h2>
      <div className={styles.editorGrid}>
       {isCredit&&<label>Original posted document ID<input {...fieldAttributes("original_document_id")} required defaultValue={String(trade.original_document_id??"")}/>{fieldError("original_document_id")}</label>}
       {documentType==="invoice"&&<>
        <label>When is this revenue earned?<select {...fieldAttributes("recognition_mode")} value={String(trade.recognition_mode??"earned_or_incurred")} onChange={event=>setTrade({...trade,recognition_mode:event.target.value})}>
         <option value="earned_or_incurred">Services already delivered</option><option value="deferred_revenue">Future services · deferred revenue</option>
        </select>{fieldError("recognition_mode")}</label>
        <label className={styles.check}><input name="performance_confirmed" type="checkbox" checked={Boolean(trade.performance_confirmed)} onChange={event=>setTrade({...trade,performance_confirmed:event.target.checked})}/>I confirm these services have been delivered</label>
        <label className={styles.wide}><span>Payment terms <span className={styles.optional}>Optional</span></span><input {...fieldAttributes("terms")} maxLength={500} value={String(trade.terms??"")} placeholder="For example, payment within 30 days" onChange={event=>setTrade({...trade,terms:event.target.value})}/>{fieldError("terms")}</label>
       </>}
       {(documentType==="bill"||documentType==="vendor_credit")&&<>
        <label>Supplier invoice date<input {...fieldAttributes("supplier_invoice_date")} type="date" defaultValue={String(trade.supplier_invoice_date??"")}/>{fieldError("supplier_invoice_date")}</label>
        <label>Supplier invoice reference<input {...fieldAttributes("supplier_invoice_key")} maxLength={160} defaultValue={String(trade.supplier_invoice_key??"")}/>{fieldError("supplier_invoice_key")}</label>
       </>}
      </div>
     </section>}
     <section className={`${styles.wide} ${styles.editorSection}`} aria-labelledby={`${editorId}-lines`}>
      <div className={styles.sectionHeading}><div><h2 id={`${editorId}-lines`}>Items and services</h2><p className={styles.hint}>Amounts are in BDT. Add a discount to the line it applies to.</p></div><span className={styles.lineCount}>{lines.length} {lines.length===1?"line":"lines"}</span></div>
      <div className={styles.lineCards}>{lines.map((line,i)=>{
       const lineDisplay=liveTotals?.lines[i];
       const prefix=`lines.${i+1}`;
       const account=options.accounts.find(option=>option.id===line.account_id);
       const tax=options.tax_codes.find(option=>option.id===line.tax_code_id);
       return <section className={styles.lineCard} key={line.uiKey} aria-labelledby={`${line.uiKey}-heading`}>
        <div className={styles.lineHeading}>
         <h3 id={`${line.uiKey}-heading`}>Line {i+1}</h3>
         <div className={styles.lineHeadingActions}><span className={styles.lineAmount}>{lineDisplay?.amounts?displayMoney(lineDisplay.amounts.gross):"Total pending"}</span>
          <button type="button" className="secondary" data-draft-edit="true" disabled={lines.length===1} aria-label={`Remove line ${i+1}`}
           onClick={()=>{setLines(current=>current.filter((_,j)=>j!==i));requestAnimationFrame(()=>focusField(`lines.${Math.min(i+1,lines.length-1)}.description`));}}>Remove</button>
         </div>
        </div>
        {!isCredit&&<label><span>Catalogue item <span className={styles.optional}>Optional</span></span><select value={line.item_id??""} onChange={event=>{
         const item=options.items.find(option=>option.id===event.target.value);
         const accountId=item?(documentType==="invoice"?item.sales_account_id:item.purchase_account_id):null;
         updateLine(i,{item_id:item?.id??null,item_snapshot:item?{name:item.name,sku:item.sku,unit:item.unit}:null,
          description:item?.name??line.description,unit_price:documentType==="invoice"?(item?.default_unit_price??line.unit_price):line.unit_price,
          account_id:accountId&&options.accounts.some(option=>option.id===accountId)?accountId:line.account_id,tax_code_id:item?.tax_code_id??line.tax_code_id});
        }}><option value="">Enter a custom item or service</option>
         {line.item_id&&!options.items.some(item=>item.id===line.item_id)&&<option value={line.item_id}>{String(line.item_snapshot?.name??"Archived item")}</option>}
         {options.items.map(item=><option key={item.id} value={item.id}>{item.sku?`${item.sku} · `:""}{item.name} ({item.unit})</option>)}
        </select></label>}
        <label>Description<input {...fieldAttributes(`${prefix}.description`)} required maxLength={500} value={line.description} placeholder="Describe the service or item" onChange={event=>updateLine(i,{description:event.target.value})}/>{fieldError(`${prefix}.description`)}</label>
        <div className={styles.lineNumbers}>
         <label><span>Quantity{typeof line.item_snapshot?.unit==="string"&&<span className={styles.optional}> · {line.item_snapshot.unit}</span>}</span>
          <input {...fieldAttributes(`${prefix}.quantity`)} required inputMode="decimal" pattern={decimalPattern} title="Use a quantity greater than zero with up to six decimal places" maxLength={21} value={line.quantity} onChange={event=>updateLine(i,{quantity:event.target.value})}/>{fieldError(`${prefix}.quantity`)}</label>
         <label>Unit price (BDT)<input {...fieldAttributes(`${prefix}.unit_price`)} required inputMode="decimal" pattern={decimalPattern} title="Use up to six decimal places, for example 1250.00" maxLength={21} value={line.unit_price} onChange={event=>updateLine(i,{unit_price:event.target.value})}/>{fieldError(`${prefix}.unit_price`)}</label>
         <label>Discount (BDT)<input {...fieldAttributes(`${prefix}.discount_amount`)} required inputMode="decimal" pattern={moneyPattern} title="Use up to two decimal places, for example 50.00" maxLength={21} value={line.discount_amount} onChange={event=>updateLine(i,{discount_amount:event.target.value})}/>{fieldError(`${prefix}.discount_amount`)}</label>
        </div>
        {isCredit&&<label>Original line ID<input {...fieldAttributes(`${prefix}.original_line_id`)} required value={line.original_line_id??""} onChange={event=>updateLine(i,{original_line_id:event.target.value||null})}/>{fieldError(`${prefix}.original_line_id`)}</label>}
        <details className={styles.lineDetails} open={!line.account_id||Boolean(fieldErrors[`${prefix}.account_id`])||undefined}>
         <summary>Account and tax <span>{account?`${account.code} · ${account.name}`:line.account_id?"Saved account":"Choose an account"} · {isCredit?"Original line’s tax":tax?.label??(line.tax_code_id?"Saved tax code":"No tax")}{line.cost_center_id?" · Cost center selected":""}</span></summary>
         <div className={styles.editorGrid}>
          <label>{documentType==="invoice"||documentType==="customer_credit"?"Income account":"Expense or asset account"}<select {...fieldAttributes(`${prefix}.account_id`)} required value={line.account_id} onChange={event=>updateLine(i,{account_id:event.target.value})}>
           <option value="">Choose an account</option>{line.account_id&&!account&&<option value={line.account_id}>Saved account · not in the active list</option>}
           {options.accounts.map(option=><option key={option.id} value={option.id}>{option.code} · {option.name}</option>)}
          </select>{fieldError(`${prefix}.account_id`)}</label>
          <label><span>Cost center <span className={styles.optional}>Optional</span></span><select value={line.cost_center_id??""} onChange={event=>{
           const center=options.cost_centers.find(option=>option.id===event.target.value);
           updateLine(i,{cost_center_id:event.target.value||null,cost_center_snapshot:center?{id:center.id,code:center.code,name:center.name}:null});
          }}><option value="">No cost center</option>{line.cost_center_id&&!options.cost_centers.some(center=>center.id===line.cost_center_id)&&<option value={line.cost_center_id}>{String(line.cost_center_snapshot?.code??"")} · {String(line.cost_center_snapshot?.name??"Archived cost center")}</option>}
           {options.cost_centers.map(center=><option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
          </select></label>
          {isCredit?<p className={`${styles.wide} ${styles.hint}`}>The credit uses the tax rate and inclusive or exclusive setting from its original posted line.</p>:<>
           <label>Tax code<select value={line.tax_code_id??""} onChange={event=>updateLine(i,{tax_code_id:event.target.value||null})}>
            <option value="">No tax</option>{line.tax_code_id&&!tax&&<option value={line.tax_code_id}>Saved tax code · not in the current list</option>}
            {options.tax_codes.map(option=><option key={option.id} value={option.id}>{option.code} · {option.label} ({option.rate_percent}%)</option>)}
           </select></label>
           <label>Unit prices are<select value={line.tax_mode} onChange={event=>updateLine(i,{tax_mode:event.target.value as "inclusive"|"exclusive"})}>
            <option value="exclusive">Before tax · tax added</option><option value="inclusive">Tax inclusive · tax included</option>
           </select></label>
          </>}
         </div>
        </details>
        {lineDisplay?.amounts?<dl className={styles.lineTotals}>
         <div><dt>Before discount</dt><dd>{displayMoney(lineDisplay.amounts.base)}</dd></div>
         <div><dt>Discount</dt><dd>{displayMoney(lineDisplay.amounts.discount)}</dd></div>
         <div><dt>Net</dt><dd>{displayMoney(lineDisplay.amounts.net)}</dd></div>
         <div><dt>Tax</dt><dd>{displayMoney(lineDisplay.amounts.tax)}</dd></div>
        </dl>:<p className={styles.hint}>{lineDisplay?.notice??"Complete the highlighted amounts to calculate this line."}</p>}
       </section>;
      })}</div>
      <button type="button" className="secondary" data-draft-edit="true" disabled={lines.length>=500} onClick={()=>{
       lineSequence.current+=1;const uiKey=`${editorId}-added-${lineSequence.current}`;
       setLines(current=>[...current,blankLine(options.accounts[0]?.id,uiKey)]);
       requestAnimationFrame(()=>focusField(`lines.${lines.length+1}.description`));
      }}>+ Add another line</button>
     </section>
     {documentType==="invoice"&&<details className={`${styles.wide} ${styles.editorSection} ${styles.optionalDetails}`} open={Boolean(trade.notes)||undefined}>
      <summary>Invoice notes <span className={styles.optional}>Optional</span></summary>
      <label>Notes shown on the invoice<textarea {...fieldAttributes("notes")} maxLength={2000} rows={3} value={String(trade.notes??"")} placeholder="Add a message or instructions for your customer" onChange={event=>setTrade({...trade,notes:event.target.value})}/>{fieldError("notes")}</label>
     </details>}
    </>}
  {movementTypes.includes(documentType)&&<section className={styles.wide}><h2>Cash movement</h2><div className={styles.line}><label>Cash/bank account<select value={movement.cash_account_id} onChange={(e)=>setMovement({...movement,cash_account_id:e.target.value})}>{options.cash_accounts.map((a)=><option key={a.id} value={a.id}>{a.name} · {a.kind}</option>)}</select></label><label>Amount (BDT)<input inputMode="decimal" value={movement.amount} onChange={(e)=>setMovement({...movement,amount:e.target.value})}/></label><label>Cash-flow class<select value={movement.cash_flow_class} onChange={e=>setMovement({...movement,cash_flow_class:e.target.value})}><option value="unclassified">Unclassified · report stays provisional</option><option value="operating">Operating</option><option value="investing">Investing</option><option value="financing">Financing</option></select></label><label>Method<select value={movement.method} onChange={(e)=>setMovement({...movement,method:e.target.value})}>{["cash","bank_transfer","mobile_wallet","card","other"].map(x=><option key={x}>{x}</option>)}</select></label><label>Reference<input value={movement.reference} onChange={(e)=>setMovement({...movement,reference:e.target.value})}/></label></div></section>}
  {documentType==="receipt"&&<section className={styles.wide}>
   <h2>Invoice allocation</h2><p>Balances are calculated for this accounting date; posting checks the selected invoices and receipt capacity again.</p>
   <button type="button" className="secondary" disabled={receiptLoading||!receiptParty||!receiptDate} onClick={()=>void refreshReceiptTargets(receiptParty,receiptDate)}>Refresh invoice list</button>
   {receiptLoading&&<p role="status">Loading eligible invoices…</p>}{receiptError&&<p role="alert" className={styles.error}>{receiptError}</p>}
   {!receiptParty?<p>Choose a customer to see their open invoices.</p>:!receiptLoading&&!receiptError&&receiptTargets.length===0?<p>No eligible open invoices for this customer and date. Any unallocated receipt remains visible as customer trade credit.</p>:receiptTargets.length>0&&<div className="table-scroll"><table><thead><tr><th>Select invoice</th><th>Issue date</th><th>Due date</th><th>Invoice total</th><th>Available (BDT)</th><th>Apply (BDT)</th></tr></thead><tbody>
    {receiptTargets.map(target=>{const plan=allocationPlan.find(p=>p.target_open_item_id===target.openItemId);return <tr key={target.openItemId}><td><label><input type="checkbox" checked={!!plan} onChange={e=>setAllocationPlan(e.target.checked?[...allocationPlan,{target_open_item_id:target.openItemId,amount:"0.00"}]:allocationPlan.filter(p=>p.target_open_item_id!==target.openItemId))}/>{target.documentNumber??target.documentId}</label></td><td>{target.issueDate}</td><td>{target.dueDate??"—"}</td><td>{target.totalAmount}</td><td>{target.residualAmount}</td><td>{plan&&<input aria-label={`Amount to apply to invoice ${target.documentNumber??target.documentId}`} inputMode="decimal" value={plan.amount} onChange={e=>setAllocationPlan(allocationPlan.map(p=>p.target_open_item_id===target.openItemId?{...p,amount:e.target.value}:p))}/>}</td></tr>;})}
   </tbody></table></div>}
   {!receiptLoading&&allocationPlan.filter(plan=>!receiptTargets.some(target=>target.openItemId===plan.target_open_item_id)).map(plan=><div key={plan.target_open_item_id} className={styles.line}>
    <p>Saved target {plan.target_open_item_id} · BDT {plan.amount}. This target is not in the current eligible invoice list. Refresh the list or remove the target before resubmitting.</p>
    <button type="button" className="secondary" data-draft-edit="true" onClick={()=>setAllocationPlan(allocationPlan.filter(row=>row.target_open_item_id!==plan.target_open_item_id))}>Remove saved target</button>
   </div>)}
  </section>}
  {documentType==="vendor_payment"&&<section className={styles.wide}><h2>Settlement plan</h2><p>Targets must be same-company open items. Their available balance is checked again when the source posts.</p>{allocationPlan.map((plan,i)=><div className={styles.line} key={i}><label>Open item ID<input value={plan.target_open_item_id} onChange={(e)=>setAllocationPlan(allocationPlan.map((p,j)=>j===i?{...p,target_open_item_id:e.target.value}:p))}/></label><label>Amount (BDT)<input inputMode="decimal" value={plan.amount} onChange={(e)=>setAllocationPlan(allocationPlan.map((p,j)=>j===i?{...p,amount:e.target.value}:p))}/></label><button type="button" className="secondary" data-draft-edit="true" onClick={()=>setAllocationPlan(allocationPlan.filter((_,j)=>j!==i))}>Remove target</button></div>)}<button type="button" className="secondary" data-draft-edit="true" onClick={()=>setAllocationPlan([...allocationPlan,{target_open_item_id:"",amount:"0.00"}])}>Add settlement target</button></section>}
  {documentType==="transfer"&&<section className={styles.wide}><h2>Transfer</h2><div className={styles.line}>{(["from_cash_account_id","to_cash_account_id"] as const).map((key)=><label key={key}>{key==="from_cash_account_id"?"From":"To"}<select value={transfer[key]} onChange={(e)=>setTransfer({...transfer,[key]:e.target.value})}>{options.cash_accounts.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>)}<label>Amount<input value={transfer.amount} onChange={(e)=>setTransfer({...transfer,amount:e.target.value})}/></label><label>Fee<input value={transfer.fee_amount} onChange={(e)=>setTransfer({...transfer,fee_amount:e.target.value})}/></label><label>Fee expense account<select value={transfer.fee_account_id} onChange={(e)=>setTransfer({...transfer,fee_account_id:e.target.value})}>{options.accounts.map((a)=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label></div></section>}
  {journalTypes.includes(documentType)&&<section className={styles.wide}><h2>Journal rows</h2>{journals.map((row,i)=><div className={styles.line} key={i}><label>Account<select value={row.account_id} onChange={(e)=>setJournals(journals.map((x,j)=>j===i?{...x,account_id:e.target.value}:x))}>{options.accounts.map((a)=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><label>Cost-center tag<select value={row.cost_center_id??""} onChange={e=>setJournals(journals.map((x,j)=>j===i?{...x,cost_center_id:e.target.value||null}:x))}><option value="">No cost center</option>{options.cost_centers.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label><label>Debit<input value={row.debit} onChange={(e)=>setJournals(journals.map((x,j)=>j===i?{...x,debit:e.target.value,credit:"0.00"}:x))}/></label><label>Credit<input value={row.credit} onChange={(e)=>setJournals(journals.map((x,j)=>j===i?{...x,credit:e.target.value,debit:"0.00"}:x))}/></label><label>Description<input value={row.description} onChange={(e)=>setJournals(journals.map((x,j)=>j===i?{...x,description:e.target.value}:x))}/></label><label>Cash-flow class (for cash lines)<select value={row.cash_flow_class} onChange={e=>setJournals(journals.map((x,j)=>j===i?{...x,cash_flow_class:e.target.value}:x))}><option value="unclassified">Unclassified</option><option value="operating">Operating</option><option value="investing">Investing</option><option value="financing">Financing</option></select></label>{journals.length>1&&<button type="button" className="secondary" data-draft-edit="true" onClick={()=>setJournals(journals.filter((_,j)=>j!==i))}>Remove row</button>}</div>)}<button type="button" className="secondary" data-draft-edit="true" onClick={()=>setJournals([...journals,{account_id:options.accounts[0]?.id??"",cost_center_id:null,debit:"0.00",credit:"0.00",description:"",cash_flow_class:"unclassified"}])}>Add row</button></section>}
    <details className={`${styles.wide} ${styles.editorSection} ${styles.optionalDetails}`} open={!/^[-+]?0(?:\.0{1,2})?$/.test(rounding.amount)||Boolean(fieldErrors.rounding_adjustment||fieldErrors.rounding_reason||fieldErrors.rounding_account_id)||undefined}>
     <summary>Rounding adjustment <span className={styles.optional}>Optional · up to ৳0.05</span></summary>
     <p className={styles.hint}>Use this only for a documented difference of a few paisa. Add a reason and the configured rounding account.</p>
     <div className={styles.editorGrid}>
      <label>Adjustment (BDT)<input {...fieldAttributes("rounding_adjustment")} required inputMode="decimal" value={rounding.amount} onChange={event=>setRounding({...rounding,amount:event.target.value})}/>{fieldError("rounding_adjustment")}</label>
      <label>Rounding reason<input {...fieldAttributes("rounding_reason")} maxLength={500} value={rounding.reason} onChange={event=>setRounding({...rounding,reason:event.target.value})}/>{fieldError("rounding_reason")}</label>
      <label>Rounding account<select {...fieldAttributes("rounding_account_id")} value={rounding.accountId} onChange={event=>setRounding({...rounding,accountId:event.target.value})}>
       <option value="">Choose an account if adjusting</option>{options.rounding_accounts.map(account=><option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
      </select>{fieldError("rounding_account_id")}</label>
     </div>
    </details>
    {isTrade&&<section className={`${styles.wide} ${styles.totalPanel}`} aria-labelledby={`${editorId}-totals`}>
     <div><h2 id={`${editorId}-totals`}>Draft totals</h2><p className={styles.hint}>Calculated from your entries. The saved preview confirms tax snapshots and totals before approval.</p></div>
     {liveTotals?.totals?<dl className={styles.documentTotals}>
      <div><dt>Before discounts</dt><dd>{displayMoney(liveTotals.totals.base)}</dd></div>
      <div><dt>Line discounts</dt><dd>− {displayMoney(liveTotals.totals.discount)}</dd></div>
      <div><dt>Net amount</dt><dd>{displayMoney(liveTotals.totals.net)}</dd></div>
      <div><dt>Tax</dt><dd>{displayMoney(liveTotals.totals.tax)}</dd></div>
      {liveTotals.totals.rounding_adjustment!=="0.00"&&<div><dt>Rounding</dt><dd>{displayMoney(liveTotals.totals.rounding_adjustment)}</dd></div>}
      <div className={styles.grandTotal}><dt>Total (BDT)</dt><dd><output aria-label="Draft total in BDT">{displayMoney(liveTotals.totals.total)}</output></dd></div>
     </dl>:<p className={styles.totalPending}>{liveTotals?.issues.length?"Check the highlighted amounts to see the complete total.":"Save and check the saved preview to confirm the total with the document’s tax snapshots."}</p>}
    </section>}
   </fieldset>
   {preview&&<div className={styles.previewPanel}><PostingPreview result={preview}/></div>}
   <footer className={styles.editorActions}>
    <p role="status" id={dirtyMessageId} className={styles.saveStatus}>{busy?action==="save"?"Saving your draft…":action==="preview"?"Loading the saved posting preview…":"Submitting the saved draft for approval…":retrySave?"Save confirmation needed":dirty?"Unsaved changes · save before preview or approval":initial&&!createNew?"All changes saved":"Draft only · save to continue"}</p>
    <div className={styles.actionButtons}>
     <button key="save" type="submit" disabled={busy}>{action==="save"?"Saving…":retrySave?"Retry save":"Save draft"}</button>
     {initial&&!createNew&&<>
      <button key="preview" type="button" className="secondary" disabled={busy||dirty||retrySave} aria-describedby={dirtyMessageId} onClick={()=>void previewPosting()}>{action==="preview"?"Loading preview…":"Preview saved posting"}</button>
      <button key="submit" type="button" className="secondary" disabled={busy||dirty||retrySave} aria-describedby={dirtyMessageId} onClick={()=>void submitForApproval()}>{action==="submit"?"Submitting…":"Submit saved draft for approval"}</button>
     </>}
    </div>
   </footer>
  </form>
 </section>;
}
