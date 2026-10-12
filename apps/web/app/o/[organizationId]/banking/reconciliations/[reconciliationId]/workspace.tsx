"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { bankingAmount, bankingCents, matchValidation, reconciliationActionObserved, suggestedMatchAmount, validateReconciliationReceipt, type BookLine, type ReconciliationAction, type ReconciliationWorkspaceData, type StatementLine } from "../../../../../../lib/reconciliation-workspace.ts";
import styles from "../../banking.module.css";

export function ReconciliationWorkspace({organizationId,data,canWrite,canFinalize,canReopen}:{organizationId:string;data:ReconciliationWorkspaceData;canWrite:boolean;canFinalize:boolean;canReopen:boolean}) {
  const router=useRouter(); const [refreshing,startRefresh]=useTransition();
  const [statementId,setStatementId]=useState("");const [bookId,setBookId]=useState("");const [amount,setAmount]=useState("");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [success,setSuccess]=useState("");
  const [uncertain,setUncertain]=useState<ReconciliationAction|null>(null);const [seenData,setSeenData]=useState(data);
  const [reverseId,setReverseId]=useState("");const [reason,setReason]=useState("");const [reopenOpen,setReopenOpen]=useState(false);const [finalizeOpen,setFinalizeOpen]=useState(false);
  const [matchError,setMatchError]=useState("");const inFlight=useRef(false);
  const session=data.reconciliation;const account=data.cash_account;const bankLines=data.statement_lines;const bookLines=data.book_lines;const matches=data.matches;
  const statement=bankLines.find(row=>row.id===statementId);const book=bookLines.find(row=>row.id===bookId);
  const locked=busy||refreshing||uncertain!==null;const editable=canWrite&&session.state==="draft"&&!locked;
  const unmatched=bankLines.filter(row=>bankingCents(row.remaining)>0n);
  const statementMovement=bankLines.reduce((sum,row)=>sum+bankingCents(row.amount),0n);
  const calculatedClosing=bankingCents(session.statement_opening)+statementMovement;
  const statementDifference=calculatedClosing-bankingCents(session.statement_closing);
  const activeCount=matches.filter(row=>!row.reversed).length;

  if(seenData!==data){
    setSeenData(data);
    if(uncertain){
      if(reconciliationActionObserved(uncertain,data)){setSuccess("The latest saved reconciliation confirms this change. Review its current state below.");setError("");}
      else {setSuccess("");setError("The latest saved reconciliation is loaded, but the earlier action's result is still unconfirmed. Review the rows and history before choosing a new action.");}
      setUncertain(null);setStatementId("");setBookId("");setAmount("");setReverseId("");setReason("");setMatchError("");setReopenOpen(false);setFinalizeOpen(false);
    }
  }
  function refresh(){if(inFlight.current)return;startRefresh(()=>router.refresh());}
  function actionRequest(action:ReconciliationAction):{path:string;method:string;body?:Record<string,string>} {
    if(action.kind==="match")return {path:"matches",method:"POST",body:{statement_line_id:action.statementId,journal_line_id:action.bookId,amount:action.amount}};
    if(action.kind==="reverse")return {path:"matches",method:"DELETE",body:{match_id:action.matchId,reason:action.reason}};
    if(action.kind==="reopen")return {path:"reopen",method:"POST",body:{reason:action.reason}};
    return {path:"finalize",method:"POST"};
  }
  async function perform(action:ReconciliationAction) {
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError("");setSuccess("");
    const request=actionRequest(action);let rejected=false;
    try {
      const response=await fetch(`/api/v1/organizations/${organizationId}/reconciliations/${session.id}/${request.path}`,{method:request.method,headers:request.body?{"Content-Type":"application/json"}:undefined,body:request.body?JSON.stringify(request.body):undefined});
      const json=await response.json();
      if(!response.ok){
        rejected=response.status>=400&&response.status<500&&typeof json?.error?.code==="string";
        const field=json?.error?.fields&&Object.values(json.error.fields).find(value=>typeof value==="string");
        throw new Error(typeof field==="string"?field:typeof json?.error?.message==="string"?json.error.message:"The change could not be confirmed.");
      }
      validateReconciliationReceipt(action,json.data,session.id);
      setSuccess(action.kind==="match"?`BDT ${action.amount} matched successfully.`:action.kind==="reverse"?"Match reversed. The original match stays in history.":action.kind==="finalize"?"Reconciliation finalized. Its evidence is now protected.":"Reconciliation reopened. The previous finalized evidence is preserved.");
      setUncertain(null);setMatchError("");setStatementId("");setBookId("");setAmount("");setReverseId("");setReason("");setReopenOpen(false);setFinalizeOpen(false);
      startRefresh(()=>router.refresh());
    }catch(cause){
      setError(cause instanceof Error?cause.message:"The change could not be confirmed.");
      // These commands have no replay token. Read the current state after an
      // unknown result; the user must review it before choosing a fresh action.
      if(!rejected)setUncertain(action);
      else if(uncertain)startRefresh(()=>router.refresh());
    }finally{inFlight.current=false;setBusy(false);}
  }
  function chooseStatement(row:StatementLine){if(!editable)return;setStatementId(row.id);setAmount(suggestedMatchAmount(row,book));setMatchError("");setError("");setSuccess("");}
  function chooseBook(row:BookLine){if(!editable)return;setBookId(row.id);setAmount(suggestedMatchAmount(statement,row));setMatchError("");setError("");setSuccess("");}
  function saveMatch(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!editable)return;const validation=matchValidation(statement,book,amount,matches);setMatchError(validation.error);if(validation.amount&&statement&&book)void perform({kind:"match",statementId:statement.id,bookId:book.id,amount:validation.amount,previousIds:matches.map(row=>row.id)});}
  function saveReason(event:FormEvent<HTMLFormElement>,kind:"reverse"|"reopen"){event.preventDefault();if(locked)return;const value=reason.trim();if(value.length<(kind==="reopen"?10:1)||value.length>(kind==="reopen"?1000:500)){setError(kind==="reopen"?"Enter a reason between 10 and 1,000 characters.":"Enter a reason up to 500 characters.");return;}void perform(kind==="reopen"?{kind,reason:value}:{kind,reason:value,matchId:reverseId});}
  const evidence=session.evidence_snapshot;
  const formatDate=(value:string)=>new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T00:00:00Z`));
  const direction=(value:string)=>bankingCents(value)<0n?"Money out":"Money in";
  const securityNeeded=/recent authentication|reauthenticate/i.test(error);

  const matchedCount=bankLines.length-unmatched.length;
  const reversedCount=matches.length-activeCount;
  const savedAt=evidence?String(evidence.finalized_at):"";
  const savedDate=new Date(savedAt);
  const savedDateLabel=Number.isNaN(savedDate.getTime())?savedAt:new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Dhaka"}).format(savedDate);

  return <main className="content">
    <header className={styles.heading}>
      <div>
        <p className="eyebrow">Banking</p>
        <div className={styles.titleLine}><h1>Bank reconciliation</h1><span className={styles.badge} data-tone={session.state==="finalized"?"success":"neutral"}>{session.state==="finalized"?"Finalized":evidence?"Reopened":"Draft"}</span></div>
        <p className={styles.metadata}><strong>{account.name}</strong><span>{formatDate(session.starts_on)} – {formatDate(session.ends_on)}</span><span>BDT</span></p>
      </div>
      <div className={styles.actions}>
        <Link href={`/o/${organizationId}/banking/reconciliations`} className={styles.textAction}>All reconciliations</Link>
        <button type="button" className="secondary" disabled={busy||refreshing} onClick={refresh}>{refreshing?"Refreshing…":"Refresh saved state"}</button>
      </div>
    </header>

    {error&&<div role="alert" className={styles.error}><p>{error}</p>{securityNeeded&&<p><Link href="/settings/security">Reauthenticate in Security</Link>, then return to this reconciliation.</p>}</div>}
    {success&&<div role="status" className={styles.success}>{success}</div>}
    {uncertain&&<section className={styles.notice} aria-label="Check saved change"><p>The result is not yet confirmed. Check the saved state and review its history before choosing another action.</p><div className={styles.actions}><button type="button" disabled={busy||refreshing} onClick={refresh}>{refreshing?"Checking…":"Check saved change"}</button></div></section>}

    <section className={styles.overview} aria-label="Statement overview">
      <dl className={styles.metrics}>
        <div><dt>Opening balance</dt><dd>{session.statement_opening}</dd></div>
        <div><dt>Statement movement</dt><dd>{bankingAmount(statementMovement)}</dd></div>
        <div><dt>Closing balance</dt><dd>{session.statement_closing}</dd></div>
        <div><dt>Statement rows matched</dt><dd>{matchedCount}<span className={styles.metricUnit}> / {bankLines.length}</span></dd></div>
      </dl>
      {statementDifference!==0n&&<p className={styles.error}>Opening balance plus imported movements differs from statement closing by BDT {bankingAmount(statementDifference)}. Check the dates and balances before finalizing.</p>}
    </section>

    <div className={styles.matchingGrid}>
      <section className={styles.tablePanel} aria-labelledby="statement-rows-title">
        <div className={styles.sectionHeading}><h2 id="statement-rows-title">Bank statement</h2><span className={styles.count}>{bankLines.length} rows</span></div>
        {!bankLines.length?<div className={styles.empty}><p>No statement rows for this account and period.</p>{canWrite&&<Link href={`/o/${organizationId}/banking/import`}>Import a statement</Link>}</div>:<div className={styles.scroll} tabIndex={0} role="region" aria-label="Statement rows">
          <table className={styles.matchTable}>
            <caption className={styles.srOnly}>Statement rows. Select a row, then a cashbook entry with the same direction. Amounts in BDT.</caption>
            <thead><tr><th scope="col">Entry</th><th scope="col" className={styles.number}>Amount</th><th scope="col" className={styles.number}>Remaining</th><th scope="col"><span className={styles.srOnly}>Match</span></th></tr></thead>
            <tbody>{bankLines.map(row=><tr key={row.id} className={statementId===row.id?styles.selected:undefined}>
              <td><strong className={styles.entryTitle}>{row.description}</strong><span className={styles.entryMeta}>{formatDate(row.transaction_date)} · Row {row.row_no}</span>{row.reference&&<span className={styles.entryMeta}>{row.reference}</span>}{row.review_required&&<span className={styles.reviewNote}>Possible duplicate — review original.</span>}</td>
              <td className={styles.number}><strong>{row.amount}</strong><span className={styles.entryMeta}>{direction(row.amount)}</span></td>
              <td className={styles.number}>{row.remaining}</td>
              <td className={styles.rowAction}>{bankingCents(row.remaining)===0n?<span className={styles.badge} data-tone="success">Matched</span>:canWrite&&session.state==="draft"?<button type="button" className="secondary" disabled={!editable} aria-pressed={statementId===row.id} aria-label={`Select statement row ${row.row_no}: ${row.description}`} onClick={()=>chooseStatement(row)}>{statementId===row.id?"Selected":"Select"}</button>:<span className={styles.muted}>Unmatched</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>

      <section className={styles.tablePanel} aria-labelledby="cashbook-entries-title">
        <div className={styles.sectionHeading}><h2 id="cashbook-entries-title">Cashbook</h2><span className={styles.count}>{bookLines.length} entries</span></div>
        {!bookLines.length?<div className={styles.empty}><p>No posted entries for this period.</p></div>:<div className={styles.scroll} tabIndex={0} role="region" aria-label="Posted cashbook entries">
          <table className={styles.matchTable}>
            <caption className={styles.srOnly}>Posted cashbook entries for {account.name}. Amounts in BDT; matched amounts remain in history.</caption>
            <thead><tr><th scope="col">Entry</th><th scope="col" className={styles.number}>Amount</th><th scope="col" className={styles.number}>Remaining</th><th scope="col"><span className={styles.srOnly}>Match</span></th></tr></thead>
            <tbody>{bookLines.map(row=><tr key={row.id} className={bookId===row.id?styles.selected:undefined}>
              <td><strong className={styles.entryTitle}>{row.document_number||row.description||"Cashbook entry"}</strong><span className={styles.entryMeta}>{formatDate(row.accounting_date)}</span>{row.document_number&&row.description&&<span className={styles.entryMeta}>{row.description}</span>}{row.reference&&<span className={styles.entryMeta}>{row.reference}</span>}{statement&&statement.transaction_date===row.accounting_date&&statement.amount===row.signed_amount&&bankingCents(row.remaining)>0n&&<span className={styles.matchHint}>Same date and amount</span>}</td>
              <td className={styles.number}><strong>{row.signed_amount}</strong><span className={styles.entryMeta}>{direction(row.signed_amount)}</span></td>
              <td className={styles.number}>{row.remaining}</td>
              <td className={styles.rowAction}>{bankingCents(row.remaining)===0n?<span className={styles.badge} data-tone="success">Matched</span>:canWrite&&session.state==="draft"?<button type="button" className="secondary" disabled={!editable} aria-pressed={bookId===row.id} aria-label={`Select cashbook entry: ${row.document_number||row.description||row.accounting_date}`} onClick={()=>chooseBook(row)}>{bookId===row.id?"Selected":"Select"}</button>:<span className={styles.muted}>Outstanding</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
    </div>

    {canWrite&&session.state==="draft"&&<section className={styles.matchComposer} aria-labelledby="selected-match-title">
      <div className={styles.sectionHeading}><h2 id="selected-match-title">Match selected entries</h2><button type="button" className={styles.textAction} disabled={!editable||(!statement&&!book)} onClick={()=>{setStatementId("");setBookId("");setAmount("");setMatchError("");}}>Clear selection</button></div>
      <div className={styles.comparison}>
        <div><span className={styles.entryMeta}>Statement row</span><strong>{statement?`Row ${statement.row_no} · ${statement.description}`:"Select a statement row"}</strong>{statement&&<span className={styles.entryMeta}>Available {statement.remaining} BDT · {direction(statement.amount)}</span>}</div>
        <div><span className={styles.entryMeta}>Cashbook entry</span><strong>{book?book.document_number||book.description||"Selected entry":"Select a cashbook entry"}</strong>{book&&<span className={styles.entryMeta}>Available {book.remaining} BDT · {direction(book.signed_amount)}</span>}</div>
      </div>
      <form onSubmit={saveMatch} className={styles.matchForm}>
        <label htmlFor="match-amount">Amount to match · BDT<input id="match-amount" value={amount} inputMode="decimal" autoComplete="off" placeholder="0.00" disabled={!editable} aria-invalid={!!matchError} aria-describedby={matchError?"match-amount-error":"match-amount-help"} onChange={event=>{if(!editable)return;setAmount(event.target.value);setMatchError("");}}/></label>
        <button type="submit" disabled={!editable||!statement||!book}>{busy?"Saving…":"Save match"}</button>
        {matchError?<p id="match-amount-error" role="alert" className={styles.fieldError}>{matchError}</p>:<p id="match-amount-help" className={styles.muted}>Partial amounts are allowed. The remaining balance stays available.</p>}
      </form>
    </section>}

    <details className={styles.details}>
      <summary><span>Match history <span className={styles.count}>{matches.length}</span></span><span className={styles.detailMeta}>{activeCount} active{reversedCount>0?` · ${reversedCount} reversed`:""}{reverseId?" · Reversal form open":""}</span></summary>
      {!matches.length?<div className={styles.detailsBody}><p className={styles.muted}>No matches recorded yet.</p></div>:<div className={styles.historyList}>{matches.map(match=>{
        const bank=bankLines.find(row=>row.id===match.statement_line_id)!;
        const ledger=bookLines.find(row=>row.id===match.journal_line_id)!;
        return <div key={match.id} className={styles.historyItem}>
          <div className={styles.historyRow}>
            <div><strong className={styles.entryTitle}>Row {bank.row_no} · {bank.description}</strong><span className={styles.entryMeta}>{ledger.document_number||ledger.description||"Cashbook entry"}</span></div>
            <strong className={styles.number}>{match.amount}<span className={styles.entryMeta}>BDT</span></strong>
            <span className={styles.badge} data-tone={match.reversed?"neutral":"success"}>{match.reversed?"Reversed":"Active"}</span>
            {!match.reversed&&canWrite&&session.state==="draft"&&reverseId!==match.id&&<button type="button" className={styles.textAction} disabled={locked} onClick={()=>{setReverseId(match.id);setReason("");setError("");}}>Reverse match</button>}
          </div>
          {!match.reversed&&canWrite&&session.state==="draft"&&reverseId===match.id&&<form onSubmit={event=>saveReason(event,"reverse")} className={styles.inlineForm}>
            <label htmlFor="reverse-match-reason">Reason for reversing this match<textarea id="reverse-match-reason" value={reason} required maxLength={500} disabled={locked} onChange={event=>setReason(event.target.value)}/></label>
            <div className={styles.actions}><button type="submit" disabled={locked}>Confirm match reversal</button><button type="button" className="secondary" disabled={locked} onClick={()=>{setReverseId("");setReason("");}}>Cancel</button></div>
          </form>}
        </div>;
      })}</div>}
    </details>

    {evidence&&<details className={styles.details}>
      <summary><span>{session.state==="finalized"?"Finalized evidence":"Previous finalized evidence"}</span><span className={styles.detailMeta}>Difference {String(evidence.unexplained_difference)} BDT</span></summary>
      <div className={styles.detailsBody}>
        <dl className={styles.summary}><div><dt>Book closing · BDT</dt><dd>{String(evidence.book_closing)}</dd></div><div><dt>Adjusted statement closing · BDT</dt><dd>{String(evidence.adjusted_statement_closing)}</dd></div><div><dt>Difference · BDT</dt><dd>{String(evidence.unexplained_difference)}</dd></div></dl>
        <p className={styles.muted}>Saved <time dateTime={savedAt}>{savedDateLabel}</time> · Asia/Dhaka{session.state==="draft"?". This snapshot is preserved while you edit the reopened session.":"."}</p>
      </div>
    </details>}

    {session.state==="draft"&&canFinalize&&<section className={styles.closingActions} aria-labelledby="finalize-title">
      <div><h2 id="finalize-title">Finalize reconciliation</h2><p className={styles.muted}>{unmatched.length>0?`${unmatched.length} statement row(s) still need matching.`:"All statement rows are matched. Review the closing balances to finish."}</p></div>
      {!finalizeOpen&&<button type="button" disabled={locked||unmatched.length>0||statementDifference!==0n} onClick={()=>{setFinalizeOpen(true);setError("");}}>Review finalization</button>}
      {finalizeOpen&&<div className={styles.inlineForm}>
        <p>Finalize {account.name} for {formatDate(session.starts_on)} to {formatDate(session.ends_on)}? Matching will be locked and closing evidence saved. Outstanding cashbook entries remain in that evidence. Recent authentication is required.</p>
        <div className={styles.actions}><button type="button" disabled={locked||unmatched.length>0||statementDifference!==0n} onClick={()=>void perform({kind:"finalize"})}>Confirm finalization</button><button type="button" className="secondary" disabled={locked} onClick={()=>setFinalizeOpen(false)}>Cancel</button></div>
      </div>}
    </section>}
    {session.state==="finalized"&&<section className={styles.closingActions} aria-labelledby="reopen-title">
      <div><h2 id="reopen-title">Reconciliation complete</h2><p className={styles.muted}>Matches and closing evidence are protected.{canReopen?" Reopen with a reason to make changes.":" An authorized account is required to reopen."}</p></div>
      {canReopen&&!reopenOpen&&<button type="button" className="secondary" disabled={locked} onClick={()=>{setReopenOpen(true);setReason("");setError("");}}>Reopen with reason</button>}
      {canReopen&&reopenOpen&&<form onSubmit={event=>saveReason(event,"reopen")} className={styles.inlineForm}>
        <label htmlFor="reopen-reconciliation-reason">Reason for reopening<textarea id="reopen-reconciliation-reason" value={reason} minLength={10} maxLength={1000} required disabled={locked} onChange={event=>setReason(event.target.value)}/></label>
        <p className={styles.muted}>Recent authentication is required. Previous finalized evidence stays preserved.</p>
        <div className={styles.actions}><button type="submit" disabled={locked}>Confirm reopen</button><button type="button" className="secondary" disabled={locked} onClick={()=>{setReopenOpen(false);setReason("");}}>Cancel</button></div>
      </form>}
    </section>}
  </main>;
}
