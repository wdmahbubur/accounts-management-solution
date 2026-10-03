"use client";
import Link from "next/link";
import { useState } from "react";
type Preferences={email_approvals:boolean;email_invoice_reminders:boolean;email_bill_reminders:boolean};
const fields:[keyof Preferences,string,string][]=[
  ["email_approvals","Approval reminders","approvals.read"],
  ["email_invoice_reminders","Due and overdue invoice reminders","sales.read"],
  ["email_bill_reminders","Due and overdue bill reminders","purchases.read"]
];
export function NotificationPreferences({organizationId,initial,capabilities}:{organizationId:string;initial:Preferences;capabilities:readonly string[]}){
  const [value,setValue]=useState(initial);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [error,setError]=useState("");
  async function save(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setMessage("");setError("");try{const response=await fetch(`/api/v1/organizations/${organizationId}/notifications/preferences`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});
    const body=await response.json();if(!response.ok)throw new Error(body?.error?.message??"Could not save preferences.");const data=body?.data;if(!data||typeof data.email_approvals!=="boolean"||typeof data.email_invoice_reminders!=="boolean"||typeof data.email_bill_reminders!=="boolean")throw new Error("Invalid saved preference response.");
    setValue({email_approvals:data.email_approvals,email_invoice_reminders:data.email_invoice_reminders,email_bill_reminders:data.email_bill_reminders});setMessage("Email preferences saved.");
  }catch(caught){setError(caught instanceof Error?caught.message:"Could not save preferences.");}finally{setBusy(false);}}
  return <form className="panel" onSubmit={event=>void save(event)} aria-label="Email notification preferences">
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {fields.map(([key,label,capability])=><label key={key} style={{display:"block",padding:".65rem 0"}}><input type="checkbox" checked={value[key]} disabled={busy||(!capabilities.includes(capability)&&!value[key])}
      onChange={event=>setValue(current=>({...current,[key]:event.target.checked}))}/> {label}
      {!capabilities.includes(capability)&&<small> Requires {capability}.</small>}
    </label>)}
    <p>Reminder events are deduplicated by member, category and company-local date. A scheduled event contains no invoice or bill name or amount.</p>
    <button type="submit" disabled={busy}>{busy?"Saving…":"Save preferences"}</button> <Link href={`/o/${organizationId}/notifications`}>Back to notifications</Link>
  </form>;
}
