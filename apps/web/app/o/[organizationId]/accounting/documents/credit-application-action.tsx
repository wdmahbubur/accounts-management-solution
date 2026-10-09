"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { moneyUnits } from "@ams/accounting";
import { displayMoney } from "../../../../../components/finance/contracts.ts";
import { detailDate } from "../../../../../components/finance/document-detail-model.ts";
import { creditApplicationMessage, confirmedCreditApplicationReceipt, isCreditApplicationDate, parseCreditApplicationOptions, type CreditApplicationOptions } from "../../../../../lib/credit-application.ts";
import { canonicalAmountInput } from "./draft-calculations.ts";
import { documentActionError, isConfirmedFormRejection, RecoverableFormRequest } from "./document-action-validation.ts";
import styles from "../../../../../components/finance/document-detail.module.css";

export function CreditApplicationAction({organizationId,documentId,initial,initialError,defaultDate,canApply}:{
  organizationId:string;documentId:string;initial:CreditApplicationOptions|null;initialError?:string;defaultDate:string;canApply:boolean;
}) {
  const router=useRouter(),id=useId();
  const [options,setOptions]=useState(initial);
  const [lastInitial,setLastInitial]=useState(initial);
  const [effectiveDate,setEffectiveDate]=useState(initial?.effective_date??defaultDate);
  const [amount,setAmount]=useState("");
  const [busy,setBusy]=useState(false);
  const [retry,setRetry]=useState(false);
  const [error,setError]=useState(initialError??"");
  const [success,setSuccess]=useState("");
  const errorRef=useRef<HTMLParagraphElement>(null),pending=useRef(false),request=useRef(new RecoverableFormRequest());
  // A server refresh can follow Unapply elsewhere on this page. Accept its new
  // balances when idle, without replacing a chosen date, amount or frozen retry.
  if(lastInitial!==initial&&!busy&&!retry) {
    setLastInitial(initial);
    if(initial?.effective_date===effectiveDate)setOptions(initial);
    else if(initial===null&&effectiveDate===defaultDate) {
      setOptions(null);
      if(initialError)setError(initialError);
    }
  }
  const scopeMatches=options?.effective_date===effectiveDate;
  const available=scopeMatches&&options?.status==="available";
  useEffect(()=>{
    if(!retry)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    window.addEventListener("beforeunload",warn);
    return()=>window.removeEventListener("beforeunload",warn);
  },[retry]);
  function showError(message:string) {setError(message);requestAnimationFrame(()=>errorRef.current?.focus());}
  async function loadOptions() {
    const query=new URLSearchParams({document_id:documentId,effective_date:effectiveDate});
    const response=await fetch(`/api/v1/organizations/${organizationId}/credit-application-options?${query}`,{cache:"no-store"});
    const json=await response.json();
    if(!response.ok)throw new Error(documentActionError(json,"Credit balances could not be loaded.").message);
    return parseCreditApplicationOptions(json.data,{organizationId,documentId,effectiveDate});
  }
  async function refresh() {
    if(pending.current||retry)return;
    if(!isCreditApplicationDate(effectiveDate)){showError("Choose a valid effective date.");return;}
    pending.current=true;setBusy(true);setError("");
    try {setOptions(await loadOptions());}
    catch(failure) {setOptions(null);showError(failure instanceof Error?failure.message:"Credit balances could not be loaded.");}
    finally {pending.current=false;setBusy(false);}
  }
  async function apply() {
    if(pending.current||!canApply)return;
    let attempt;
    try {
      if(retry)attempt=request.current.begin("");
      else {
        if(!options||!scopeMatches||!available)throw new Error("Refresh the available credit for this date before applying it.");
        const canonicalAmount=canonicalAmountInput(amount);
        if(moneyUnits(canonicalAmount)<=0n||moneyUnits(canonicalAmount)>moneyUnits(options.available_amount))throw new Error(`Enter an amount above zero and no more than ${displayMoney(options.available_amount)}.`);
        attempt=request.current.begin(JSON.stringify({debit_open_item_id:options.debit_open_item_id,credit_open_item_id:options.credit_open_item_id,amount:canonicalAmount,effective_date:effectiveDate}));
      }
    } catch(failure) {showError(failure instanceof Error?failure.message:"Check the credit amount and date.");return;}
    if(!attempt)return;
    pending.current=true;setBusy(true);setError("");setSuccess("");
    try {
      const response=await fetch(`/api/v1/organizations/${organizationId}/allocations`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":attempt.key,"X-Request-Id":`credit-apply-${crypto.randomUUID()}`},body:attempt.body});
      const json=await response.json();
      if(!response.ok) {
        if(isConfirmedFormRejection(response.status,json))request.current.rejected();
        throw new Error(documentActionError(json,"Credit could not be applied.").message);
      }
      const sent=JSON.parse(attempt.body) as {amount:string;effective_date:string};
      const receipt=confirmedCreditApplicationReceipt(json.data,{amount:sent.amount,effectiveDate:sent.effective_date});
      request.current.confirmed();setRetry(false);setAmount("");setOptions(null);
      setSuccess(`${displayMoney(receipt.amount)} applied successfully, effective ${detailDate(receipt.effectiveDate)}.`);
      try {setOptions(await loadOptions());}
      catch {showError("The credit application is recorded. Refresh balances to see the updated amount.");}
      router.refresh();
    } catch(failure) {
      request.current.uncertain();setRetry(request.current.needsRetry);
      if(!request.current.needsRetry)setOptions(null);
      showError(failure instanceof Error?failure.message:"Credit could not be applied.");
    } finally {pending.current=false;setBusy(false);}
  }
  return <section className={styles.section} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>Apply credit to the original {options?.original_document_type==="bill"?"bill":"document"}</h2>
    <p className={styles.hint}>This records a dated settlement between existing entries. No cash is moved.</p>
    {options?<>
      <p>Original {options.original_document_type==="bill"?"bill":"invoice"}: <Link href={`/o/${organizationId}/accounting/documents/${options.original_document_id}`}>{options.original_document_number??"Open original document"}</Link></p>
      <dl className={styles.statusStrip}>
        <div><dt>Unused credit · BDT</dt><dd>{options.credit_residual_amount===null?"Not yet effective":displayMoney(options.credit_residual_amount)}</dd></div>
        <div><dt>Original outstanding · BDT</dt><dd>{options.original_residual_amount===null?"Not yet effective":displayMoney(options.original_residual_amount)}</dd></div>
        <div><dt>Available to apply · BDT</dt><dd>{displayMoney(options.available_amount)}</dd></div>
      </dl>
      <p className={styles.hint}>Balances for {detailDate(options.effective_date)}. Available amounts also account for later dated settlements.</p>
      <p className={styles.hint}>{creditApplicationMessage(options)}</p>
    </>:null}
    {success?<p role="status" className={styles.applicationSuccess}>{success}</p>:null}
    {error?<p ref={errorRef} tabIndex={-1} role="alert" className={styles.applicationError}>{error}</p>:null}
    <form className={styles.applicationForm} onSubmit={event=>{event.preventDefault();void apply();}}>
      <label>Application date<input type="date" name="effective_date" required value={effectiveDate} disabled={busy||retry} onChange={event=>{setEffectiveDate(event.target.value);setError("");}}/></label>
      <button type="button" className="secondary" disabled={busy||retry} onClick={()=>void refresh()}>{busy?"Working…":"Refresh available credit"}</button>
      {canApply?<>
        <label>Credit amount to apply · BDT<input name="amount" inputMode="decimal" pattern="(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?" required={!retry} disabled={busy||retry||!available} value={amount} onChange={event=>{setAmount(event.target.value);setError("");}}/></label>
        <button type="submit" disabled={busy||(!retry&&!available)}>{busy?"Working…":retry?"Retry the same credit application":"Apply credit"}</button>
      </>:<p className={styles.hint}>An authorized user with settlement permission can apply this credit.</p>}
    </form>
    {options&&!scopeMatches?<p role="status" className={styles.notice}>The application date changed. Refresh available credit before continuing.</p>:null}
    {retry?<p role="status" className={styles.notice}>The response was not confirmed. Your amount, date and request are preserved; retry the same application to confirm its result.</p>:null}
  </section>;
}
