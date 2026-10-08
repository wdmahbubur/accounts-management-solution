"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { addressFieldDefinitions, taxFieldDefinitions, type ContactFieldDefinition } from "../../../../lib/contact-details.ts";
import { additionalContactDetails, contactEditFields, mergeContactFields } from "../../../../lib/contact-fields.ts";
import { ContactSaveGuard, contactSaveDestination, performContactSave, LatestContactLookup, type ContactSaveState } from "../../../../lib/contact-requests.ts";
import styles from "./contacts.module.css";

export type ContactRecord = {
  id:string;display_name:string;legal_name:string|null;is_customer:boolean;is_vendor:boolean;email:string|null;phone:string|null;
  billing_address:Record<string,unknown>;tax_identifiers:Record<string,unknown>;payment_terms_days:number;credit_limit:string|null;
  external_key:string|null;is_active:boolean;row_version:number;
};
type Props = { organizationId:string;scope:"customer"|"vendor";initial?:ContactRecord;readableScopes:readonly ("customer"|"vendor")[] };
const fieldNames:Record<string,string> = { legal_name:"Legal name",is_active:"Active contact",display_name:"Display name",email:"Email",phone:"Phone",roles:"Business roles",payment_terms_days:"Payment terms",credit_limit:"Credit limit",external_key:"External reference",billing_address:"Billing address",tax_identifiers:"Tax identifiers",contact:"Contact",expected_version:"Contact version" };

export function ContactForm(props:Props) {
  return <EditableContactForm key={`${props.organizationId}:${props.initial?.id??`new-${props.scope}`}`} {...props}/>;
}
function EditableContactForm({organizationId,scope,initial,readableScopes}:Props) {
  const router=useRouter(); const formId=useId(); const errorSummary=useRef<HTMLDivElement>(null);
  // A background server refresh must not advance the expected version underneath local edits.
  const [baseline]=useState(initial);
  const [name,setName]=useState(baseline?.display_name??""); const [legal,setLegal]=useState(baseline?.legal_name??"");
  const [customer,setCustomer]=useState(baseline?.is_customer??scope==="customer"); const [vendor,setVendor]=useState(baseline?.is_vendor??scope==="vendor");
  const [email,setEmail]=useState(baseline?.email??""); const [phone,setPhone]=useState(baseline?.phone??"");
  const [terms,setTerms]=useState(String(baseline?.payment_terms_days??0)); const [credit,setCredit]=useState(baseline?.credit_limit??"");
  const [external,setExternal]=useState(baseline?.external_key??""); const [active,setActive]=useState(baseline?.is_active??true);
  const [address,setAddress]=useState<Record<string,string>>(()=>Object.fromEntries(contactEditFields(baseline?.billing_address,addressFieldDefinitions).map(field=>[field.name,field.value])));
  const [tax,setTax]=useState<Record<string,string>>(()=>Object.fromEntries(contactEditFields(baseline?.tax_identifiers,taxFieldDefinitions).map(field=>[field.name,field.value])));
  const [warning,setWarning]=useState(""); const [error,setError]=useState(""); const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
  const [saveState,setSaveState]=useState<ContactSaveState>("idle"); const [dirty,setDirty]=useState(false); const [savedPath,setSavedPath]=useState("");
  const saveGuard=useRef(new ContactSaveGuard()); const lookup=useRef(new LatestContactLookup());
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null); const lookupAbort=useRef<AbortController|null>(null);
  const busy=saveState==="pending"; const frozen=saveState!=="idle";
  const profilePath=baseline?`/o/${organizationId}/${scope==="customer"?"sales/customers":"purchases/vendors"}/${baseline.id}`:null;

  useEffect(()=>{if(error||Object.keys(fieldErrors).length>0)errorSummary.current?.focus();},[error,fieldErrors]);
  function errorAttributes(field:string) {return {"aria-invalid":fieldErrors[field]?true:undefined,"aria-describedby":fieldErrors[field]?`${formId}-${field}-error`:undefined};}
  function message(field:string) {return <FieldError id={`${formId}-${field}-error`} message={fieldErrors[field]}/>;}
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);lookupAbort.current?.abort();lookup.current.next();},[]);
  function checkDuplicate(value:string) {
    const revision=lookup.current.next(); if(timer.current)clearTimeout(timer.current); lookupAbort.current?.abort(); setWarning("");
    const query=value.trim(); if(query.length<3)return;
    timer.current=setTimeout(()=>{void (async()=>{
      const controller=new AbortController();lookupAbort.current=controller;
      try {
        const response=await fetch(`/api/v1/organizations/${organizationId}/contacts?scope=${scope}&status=all&search=${encodeURIComponent(query.slice(0,100))}&limit=10`,{signal:controller.signal,cache:"no-store"});
        const result=await response.json();if(!response.ok||!Array.isArray(result?.data?.items))throw new Error();
        if(!lookup.current.isCurrent(revision))return;
        const duplicate=(result.data.items as {id:string;display_name:string}[]).find(contact=>contact.id!==baseline?.id&&typeof contact.display_name==="string"&&contact.display_name.toLocaleLowerCase()===query.toLocaleLowerCase());
        if(duplicate)setWarning(`A contact named “${duplicate.display_name}” already exists. Check the directory before creating another; separate contacts may have the same name.`);
      } catch {if(lookup.current.isCurrent(revision)&&!controller.signal.aborted)setWarning("Matching contacts could not be checked. You can review the directory or continue saving.");}
    })();},300);
  }

  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(saveGuard.current.state==="pending"||saveGuard.current.state==="conflict"||saveGuard.current.state==="saved")return;
    setError("");setFieldErrors({});
    if(!/^\d+$/.test(terms)||Number(terms)>3650){setFieldErrors({payment_terms_days:"Enter a whole number from 0 to 3650."});return;}
    const body=JSON.stringify({expected_version:baseline?.row_version??null,contact:{display_name:name,legal_name:legal||null,is_customer:customer,is_vendor:vendor,email:email||null,phone:phone||null,
      billing_address:mergeContactFields(baseline?.billing_address,addressFieldDefinitions,address),tax_identifiers:mergeContactFields(baseline?.tax_identifiers,taxFieldDefinitions,tax),
      payment_terms_days:Number(terms),credit_limit:credit||null,external_key:external||null,is_active:active}});
    const request=saveGuard.current.begin(body,()=>crypto.randomUUID());if(!request)return;setSaveState("pending");let confirmed=false;
    try {
      const outcome=await performContactSave({url:`/api/v1/organizations/${organizationId}/contacts${baseline?`/${baseline.id}`:""}`,method:baseline?"PATCH":"POST",expectedId:baseline?.id,request,requestId:`contact-save-${crypto.randomUUID()}`});
      if(outcome.kind==="uncertain") {saveGuard.current.uncertain();setError("The save could not be confirmed. Keep this page open and retry the same save; your entries are preserved and locked until its result is known.");return;}
      if(outcome.kind==="conflict") {saveGuard.current.conflict();setError(outcome.stale?"This contact changed after you opened it. Your edits are still here. Compare the current profile before discarding your edits and loading the latest version.":"This save request conflicts with an existing request. Your edits are still here; check whether the contact was already saved before starting again.");return;}
      if(outcome.kind==="rejected") {saveGuard.current.reject();setError(outcome.message);setFieldErrors(outcome.fields);return;}
      confirmed=true;saveGuard.current.saved();setDirty(false);
      const destination=contactSaveDestination(organizationId,scope,readableScopes,outcome.contact);
      if(destination){setSavedPath(destination);router.push(destination);router.refresh();}
    } catch {if(!confirmed){saveGuard.current.uncertain();setError("The save could not be confirmed. Keep this page open and retry the same save; your entries are preserved and locked until its result is known.");}}
    finally {setSaveState(saveGuard.current.state);}
  }

  return <form className={`panel ${styles.form}`} onSubmit={save} onChangeCapture={()=>setDirty(true)} data-unsaved={dirty?"true":"false"}>
    <p className={styles.intro}>Add the details you use for invoices and payments. Address and tax information are optional.</p>
    {(error||Object.keys(fieldErrors).length>0)&&<div className={styles.error} role="alert" tabIndex={-1} ref={errorSummary} id={`${formId}-errors`}><p>{error||"Review these details before saving."}</p>{Object.keys(fieldErrors).length>0&&<ul>{Object.entries(fieldErrors).map(([field,message])=><li key={field}><strong>{fieldNames[field]??"Contact"}:</strong> {message}</li>)}</ul>}</div>}
    {saveState==="conflict"&&<div className={styles.recovery}>{profilePath&&<a href={profilePath} target="_blank" rel="noopener noreferrer">Open current profile in a new tab</a>}<button type="button" className="secondary" onClick={()=>window.location.reload()}>Discard my edits and load latest</button></div>}
    {saveState==="saved"&&<p role="status">Contact saved. {savedPath?<Link href={savedPath}>Open saved profile</Link>:"Your current access does not include this contact’s profile."}</p>}
    <fieldset disabled={frozen} className={styles.fields} aria-describedby={fieldErrors.contact||fieldErrors.body?`${formId}-errors`:undefined}>
      <legend>Contact details</legend>
      <div className={styles.grid}>
        <label>Display name <span className={styles.required}>(required)</span><input {...errorAttributes("display_name")} name="display_name" autoComplete="organization" required maxLength={200} value={name} onChange={event=>{setName(event.target.value);checkDuplicate(event.target.value);}}/>{message("display_name")}</label>
        <label>Legal name<input {...errorAttributes("legal_name")} name="legal_name" maxLength={200} value={legal} onChange={event=>setLegal(event.target.value)}/>{message("legal_name")}</label>
        <label>Email<input {...errorAttributes("email")} name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={event=>setEmail(event.target.value)}/>{message("email")}</label>
        <label>Phone<input {...errorAttributes("phone")} name="phone" type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={event=>setPhone(event.target.value)}/>{message("phone")}</label>
      </div>
      {warning&&<p role="status" className={styles.notice}>{warning}</p>}
      <fieldset className={styles.roles} {...errorAttributes("roles")}><legend>Business roles</legend><label className={styles.check}><input type="checkbox" checked={customer} onChange={event=>setCustomer(event.target.checked)}/>Customer</label><label className={styles.check}><input type="checkbox" checked={vendor} onChange={event=>setVendor(event.target.checked)}/>Supplier</label><p>A contact can have both roles. Customer and supplier balances stay separate.</p>{message("roles")}</fieldset>
      <ContactObjectFields title="Billing address" error={fieldErrors.billing_address} errorId={`${formId}-billing_address-error`} original={baseline?.billing_address} definitions={addressFieldDefinitions} values={address} onChange={(key,value)=>setAddress(current=>({...current,[key]:value}))}/>
      <ContactObjectFields title="Tax identifiers" error={fieldErrors.tax_identifiers} errorId={`${formId}-tax_identifiers-error`} original={baseline?.tax_identifiers} definitions={taxFieldDefinitions} values={tax} onChange={(key,value)=>setTax(current=>({...current,[key]:value}))}/>
      <section><h2 className={styles.sectionTitle}>Terms and reference</h2><div className={styles.grid}>
        <label>Payment terms (days)<input {...errorAttributes("payment_terms_days")} name="payment_terms_days" type="number" required min={0} max={3650} step={1} value={terms} onChange={event=>setTerms(event.target.value)}/>{message("payment_terms_days")}</label>
        <label>Credit limit (BDT)<input {...errorAttributes("credit_limit")} name="credit_limit" inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,2})?" value={credit} onChange={event=>setCredit(event.target.value)}/>{message("credit_limit")}<span className={styles.hint}>Leave blank if no credit limit is set.</span></label>
        <label>External reference<input {...errorAttributes("external_key")} name="external_key" maxLength={160} value={external} onChange={event=>setExternal(event.target.value)}/>{message("external_key")}</label>
        {baseline&&<label className={styles.check}><input {...errorAttributes("is_active")} type="checkbox" checked={active} onChange={event=>setActive(event.target.checked)}/>Active contact{message("is_active")}</label>}
      </div></section>
    </fieldset>
    <div className={styles.actions}><button type="submit" disabled={busy||saveState==="conflict"||saveState==="saved"||(!customer&&!vendor)}>{busy?"Saving contact…":saveState==="uncertain"?"Retry the same save":baseline?"Save contact":"Create contact"}</button><span className={styles.hint}>{baseline?"Changes apply to future documents. Issued invoice details stay unchanged.":"Saving a contact does not create a financial transaction."}</span></div>
  </form>;
}

function ContactObjectFields({title,original,definitions,values,onChange,error,errorId}:{title:string;error?:string;errorId:string;original:unknown;definitions:readonly ContactFieldDefinition[];values:Record<string,string>;onChange:(key:string,value:string)=>void}) {
  const fields=contactEditFields(original,definitions),additional=additionalContactDetails(original,definitions);
  return <section role="group" aria-labelledby={`${errorId}-heading`}><h2 id={`${errorId}-heading`} className={styles.sectionTitle}>{title}</h2><FieldError id={errorId} message={error}/><div className={styles.grid}>{fields.map(field=><label key={field.name}>{field.label}<input aria-invalid={error?true:undefined} aria-describedby={error?errorId:undefined} name={`${title==="Billing address"?"address":"tax"}_${field.name}`} autoComplete={field.autoComplete??"off"} value={values[field.name]??""} disabled={field.readOnly} onChange={event=>onChange(field.name,event.target.value)}/>{field.readOnly&&<span className={styles.hint}>Existing information uses a different format and is kept below.</span>}</label>)}</div>
    {additional.length>0&&<details className={styles.legacy}><summary>Additional saved {title.toLowerCase()} details</summary><p>These existing details are kept when you save this form.</p><dl>{additional.map((detail,index)=><div key={index}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl></details>}
  </section>;
}

function FieldError({id,message}:{id:string;message?:string}) {return message?<span id={id} className={styles.fieldError}>{message}</span>:null;}
