"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { emptyMapping, importNextHref, mappingFields, readImportReceipt, readInspection, readStatementPreview, restoreMapping, validateMapping, type AmountFormat, type ImportMapping, type ImportReceipt, type MappingKey, type StatementPreview } from "./import-interactions.ts";
import styles from "../banking.module.css";

type Row = Record<string, unknown>;
type Attempt = { file:File; account:string; mapping:ImportMapping; format:AmountFormat; preview:StatementPreview };
type SavedImport = ImportReceipt & { accountName:string; fileName:string };
const mappingLabels:Record<MappingKey,string>={date:"Transaction date",description:"Description",amount:"Signed amount",debit:"Debit / money out",credit:"Credit / money in",valueDate:"Value date (optional)",balance:"Balance after row (optional)",reference:"Bank reference (optional)"};

export function StatementImport({ organizationId, accounts }: { organizationId:string; accounts:Row[] }) {
  const [file,setFile]=useState<File|null>(null);
  const [account,setAccount]=useState("");
  const [inspection,setInspection]=useState<ReturnType<typeof readInspection>|null>(null);
  const [mapping,setMapping]=useState<ImportMapping>(emptyMapping);
  const [format,setFormat]=useState<AmountFormat>("signed");
  const [preview,setPreview]=useState<StatementPreview|null>(null);
  const [error,setError]=useState("");
  const [fieldErrors,setFieldErrors]=useState<Partial<Record<MappingKey,string>>>({});
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState<"inspect"|"preview"|"import"|null>(null);
  const [uncertain,setUncertain]=useState<Attempt|null>(null);
  const [result,setResult]=useState<SavedImport|null>(null);
  const inFlight=useRef(false); const fileInput=useRef<HTMLInputElement>(null);
  const locked=busy!==null || uncertain!==null;
  const headers=inspection?.headers ?? [];
  const selectedName=String(accounts.find(row=>row.id===account)?.name ?? "Selected account");

  function storageKey(accountId:string, sourceHeaders:string[]) { return `ams-bank-import:${organizationId}:${accountId}:${JSON.stringify(sourceHeaders.map(header=>header.trim().toLowerCase()))}`; }
  function changedSource() { setInspection(null);setMapping(emptyMapping());setPreview(null);setResult(null);setError("");setNotice("");setFieldErrors({}); }
  function requestData(action:string, source:{file:File;account:string;mapping:ImportMapping;format:AmountFormat}, hash?:string) {
    const data=new FormData();data.set("file",source.file);data.set("cash_account_id",source.account);data.set("mapping",JSON.stringify(mappingFields(source.mapping,source.format)));data.set("action",action);
    if(hash)data.set("file_sha256",hash);
    return data;
  }
  function responseError(json:unknown, fallback:string):string {
    if(!json || typeof json!=="object")return fallback;
    const e=(json as {error?:{message?:unknown;fields?:Record<string,unknown>}}).error;
    const field=e?.fields && Object.values(e.fields).find(value=>typeof value==="string");
    return typeof field==="string" ? field : typeof e?.message==="string" ? e.message : fallback;
  }
  async function inspectOrPreview(action:"inspect"|"preview") {
    if(inFlight.current || uncertain || !file || !account)return;
    if(action==="preview") {
      const validation=validateMapping(mapping,format,headers.length);setFieldErrors(validation);
      if(Object.keys(validation).length){setError("Choose the highlighted columns before previewing.");return;}
      if(!inspection)return;
    }
    inFlight.current=true;setBusy(action);setError("");setPreview(null);setResult(null);
    try {
      const response=await fetch(`/api/v1/organizations/${organizationId}/bank-imports`,{method:"POST",body:requestData(action,{file,account,mapping,format})});
      const json=await response.json();
      if(!response.ok)throw new Error(responseError(json,"The statement could not be read. Your file and selections have been kept."));
      if(action==="inspect") {
        const next=readInspection(json.data);setInspection(next);
        try {
          const saved=restoreMapping(localStorage.getItem(storageKey(account,next.headers)),next.headers.length);
          if(saved){setMapping(saved.mapping);setFormat(saved.format);setNotice("Your saved column mapping was loaded. Review it before importing.");}
        } catch { setNotice("Saved mappings are unavailable in this browser. You can still choose columns and import."); }
      } else setPreview(readStatementPreview(json.data,inspection!.sha256));
    } catch(cause) { setError(cause instanceof Error?cause.message:"The statement could not be read. Please retry."); }
    finally {inFlight.current=false;setBusy(null);}
  }
  function saveMapping() {
    if(locked || !inspection)return;
    const validation=validateMapping(mapping,format,headers.length);setFieldErrors(validation);
    if(Object.keys(validation).length)return;
    try {localStorage.setItem(storageKey(account,headers),JSON.stringify({...emptyMapping(),...Object.fromEntries(Object.entries(mappingFields(mapping,format)).map(([key,value])=>[key,String(value)]))}));setNotice("Column mapping saved for this account on this device.");}
    catch {setNotice("This browser could not save the mapping. The current import can still continue.");}
  }
  async function importFile(retry?:Attempt) {
    if(inFlight.current)return;
    const attempt=retry ?? (file && preview && preview.valid_count>0 && preview.row_count===preview.valid_count ? {file,account,mapping:{...mapping},format,preview}:null);
    if(!attempt)return;
    inFlight.current=true;setBusy("import");setError("");
    let confirmedRejection=false;
    try {
      const response=await fetch(`/api/v1/organizations/${organizationId}/bank-imports`,{method:"POST",body:requestData("import",attempt,attempt.preview.file_sha256)});
      const json=await response.json();
      if(!response.ok) {
        confirmedRejection=response.status>=400 && response.status<500 && typeof json?.error?.code==="string";
        throw new Error(responseError(json,"The import result could not be confirmed."));
      }
      const saved=readImportReceipt(json.data,attempt.account,attempt.preview.valid_count);
      setResult({...saved,accountName:String(accounts.find(row=>row.id===attempt.account)?.name??"Selected account"),fileName:attempt.file.name});
      setUncertain(null);setFile(null);setInspection(null);setPreview(null);setMapping(emptyMapping());setFieldErrors({});setNotice("");
      if(fileInput.current)fileInput.current.value="";
    } catch(cause) {
      if(!confirmedRejection||retry||uncertain)setUncertain(attempt);
      setError(cause instanceof Error?cause.message:"The import could not be confirmed.");
    } finally {inFlight.current=false;setBusy(null);}
  }
  function column(key:MappingKey,required=false) {
    return <label key={key} htmlFor={`statement-${key}`}>{mappingLabels[key]}{required?" *":""}<select id={`statement-${key}`} value={mapping[key]} disabled={locked} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key]?`statement-${key}-error`:undefined} onChange={event=>{if(inFlight.current||uncertain)return;setMapping(old=>({...old,[key]:event.target.value}));setPreview(null);setFieldErrors({});setError("");}}><option value="">Choose a column</option>{headers.map((header,index)=><option key={index} value={index}>{header||`Column ${index+1}`}</option>)}</select>{fieldErrors[key]&&<span className={styles.fieldError} id={`statement-${key}-error`}>{fieldErrors[key]}</span>}</label>;
  }

  return <main className="content"><header className={styles.heading}><div><p className="eyebrow">Banking</p><h1>Import bank statement</h1><p>Choose an account, map your columns, then review the rows before saving.</p></div><Link href={`/o/${organizationId}/banking/reconciliations`}>View reconciliations</Link></header><div className={styles.stack}>
    {error&&<div role="alert" className={styles.error}>{error}</div>}
    {uncertain&&<section className={styles.notice} aria-label="Check import result"><p>The save may already have completed. Your account, file and mapping are kept together. Retry this same import to check; the same file will not create duplicate rows in this account.</p><div className={styles.actions}><button disabled={busy!==null} onClick={()=>void importFile(uncertain)}>{busy?"Checking import…":"Retry same import"}</button><Link href={`/o/${organizationId}/banking/reconciliations?cash_account_id=${uncertain.account}`}>Check saved reconciliations</Link></div></section>}
    {result&&<section className={`panel ${styles.success}`} role="status"><h2>{result.duplicate?"Statement already imported":"Statement imported"}</h2><p><strong>{result.fileName}</strong> · {result.accountName}</p><p>{result.duplicate?"This exact file was already saved for this account. No additional statement rows were added.":`${result.row_count} statement rows saved${result.review_count?`; ${result.review_count} need duplicate review`:""}.`}</p><p>Continue to match the statement against your posted cashbook.</p><div className={styles.actions}><Link className="primary" href={importNextHref(organizationId,result)}>Continue to reconciliation</Link></div></section>}
    {!accounts.length?<section className="panel"><h2>Add an account first</h2><p>Create an active cash, bank or wallet account for this statement.</p><Link href={`/o/${organizationId}/banking/accounts`}>Open cash and bank accounts</Link></section>:<>
      <section className="panel"><h2>1. Choose file and account</h2><fieldset disabled={locked} className={styles.fieldSet}><div className={styles.grid}><label htmlFor="statement-account">Cash or bank account<select id="statement-account" value={account} onChange={event=>{if(inFlight.current||uncertain)return;setAccount(event.target.value);changedSource();}}><option value="">Choose an account</option>{accounts.map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.name)} · {String(row.kind).replaceAll("_"," ")}</option>)}</select></label><label htmlFor="statement-file">Statement file<input id="statement-file" type="file" ref={fileInput} accept=".csv,.xlsx" onChange={event=>{if(inFlight.current||uncertain)return;setFile(event.target.files?.[0]??null);changedSource();}}/><span className={styles.muted}>UTF-8 CSV or a single-sheet XLSX, up to 8 MB.</span></label></div><div className={styles.actions}><button type="button" disabled={!file||!account} onClick={()=>void inspectOrPreview("inspect")}>{busy==="inspect"?"Reading columns…":inspection?"Read columns again":"Read file columns"}</button></div></fieldset></section>
      {inspection&&<section className="panel"><h2>2. Match your columns</h2><p className={styles.muted}>{file?.name} · {selectedName}</p><fieldset disabled={locked} className={styles.fieldSet}><label htmlFor="statement-amount-format">How does this statement show money?<select id="statement-amount-format" value={format} onChange={event=>{if(inFlight.current||uncertain)return;setFormat(event.target.value as AmountFormat);setPreview(null);setFieldErrors({});setError("");}}><option value="signed">One signed amount column</option><option value="split">Separate debit and credit columns</option></select></label><p className={styles.muted}>{format==="signed"?"Positive amounts are money in; negative amounts are money out.":"Debit is money out; credit is money in. The unused side of a row may be blank."}</p><div className={styles.grid}>{column("date",true)}{column("description",true)}{format==="signed"?column("amount",true):<>{column("debit",true)}{column("credit",true)}</>}{column("valueDate")}{column("balance")}{column("reference")}</div><div className={styles.actions}><button type="button" onClick={()=>void inspectOrPreview("preview")}>{busy==="preview"?"Checking rows…":"Preview rows"}</button><button type="button" className="secondary" onClick={saveMapping}>Save column mapping</button></div></fieldset>{notice&&<p role="status" className={styles.notice}>{notice}</p>}</section>}
      {preview&&<section className="panel"><h2>3. Review and import</h2><dl className={styles.summary}><div><dt>Account</dt><dd>{selectedName}</dd></div><div><dt>Valid rows</dt><dd>{preview.valid_count}</dd></div><div><dt>Rows to correct</dt><dd>{preview.row_count-preview.valid_count}</dd></div>{preview.starts_on&&<div><dt>Statement dates</dt><dd>{preview.starts_on} to {preview.ends_on}</dd></div>}</dl>{preview.repeated_fingerprint_groups+preview.prior_fingerprint_groups>0&&<p role="status" className={styles.notice}>{preview.repeated_fingerprint_groups} repeated group(s) in this file; {preview.prior_fingerprint_groups} group(s) resemble earlier imports. These rows are retained and flagged for review.</p>}{preview.errors.length>0&&<div role="alert" className={styles.error}><h3>Correct these rows in your file</h3><ul>{preview.errors.map(row=><li key={row.row_no}>Row {row.row_no}: {row.message}</li>)}</ul>{preview.row_count-preview.valid_count>preview.errors.length&&<p>Showing the first {preview.errors.length} errors. Correct the file and preview again.</p>}</div>}<div className={styles.scroll}><table><caption>First {Math.max(0,preview.preview.length-1)} data rows from the selected file</caption><thead><tr>{preview.headers.map((header,index)=><th key={index} scope="col">{header||`Column ${index+1}`}</th>)}</tr></thead><tbody>{preview.preview.slice(1).map((row,index)=><tr key={index}>{preview.headers.map((_,column)=><td key={column}>{String(row[column]??"")}</td>)}</tr>)}</tbody></table></div><p className={styles.muted}>Import saves statement evidence. It does not create or change cashbook entries.</p><div className={styles.actions}><button type="button" disabled={locked||preview.valid_count===0||preview.row_count!==preview.valid_count} onClick={()=>void importFile()}>{busy==="import"?"Importing…":`Import ${preview.valid_count} rows`}</button></div></section>}
    </>}
  </div></main>;
}
