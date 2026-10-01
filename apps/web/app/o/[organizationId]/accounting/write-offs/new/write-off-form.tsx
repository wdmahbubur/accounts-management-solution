"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";

type Item={id:string;party_name:string;reference:string;issue_date:string;available_amount:string};type Account={id:string;code:string;name:string};
export function WriteOffForm({organizationId,today,receivables,accounts}:{organizationId:string;today:string;receivables:Item[];accounts:Account[]}){
 const router=useRouter();const key=useRef(crypto.randomUUID());const [target,setTarget]=useState("");const [account,setAccount]=useState("");const [amount,setAmount]=useState("");const [date,setDate]=useState(today);const [reason,setReason]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const selected=receivables.find(item=>item.id===target);async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError("");try{const response=await fetch(`/api/v1/organizations/${organizationId}/write-offs`,{method:"POST",headers:{"Content-Type":"application/json","X-Request-Id":`write-off-${crypto.randomUUID()}`,"Idempotency-Key":key.current},body:JSON.stringify({accounting_date:date,target_open_item_id:target,expense_account_id:account,amount,reason})});const body=await response.json();if(!response.ok)throw new Error(body?.error?.message??"The write-off draft could not be saved.");router.push(`/o/${organizationId}/accounting/documents/${body.data.documentId}`);router.refresh();}catch(e){setError(e instanceof Error?e.message:"The write-off draft could not be saved.");}finally{setBusy(false);}}
 return <form className="panel" onSubmit={submit}><label>Receivable item<select required value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose an open AR debit</option>{receivables.map(i=><option key={i.id} value={i.id}>{i.party_name} · {i.reference} · available BDT {i.available_amount}</option>)}</select></label>
  <label>Bad-debt expense account<select required value={account} onChange={e=>setAccount(e.target.value)}><option value="">Choose an expense account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
  <label>Write-off amount (BDT)<input required inputMode="decimal" pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?" max={selected?.available_amount} value={amount} onChange={e=>setAmount(e.target.value)}/>{selected&&<small>Available on {date}: BDT {selected.available_amount}</small>}</label>
  <label>Accounting date<input required type="date" min={selected?.issue_date} value={date} onChange={e=>setDate(e.target.value)}/></label>
  <label>Adjustment reason<textarea required minLength={10} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  {error&&<p role="alert">{error}</p>}<p>Draft only. It will not affect the ledger until it is approved and posted.</p><button disabled={busy||!receivables.length||!accounts.length}>{busy?"Saving…":"Save write-off draft"}</button></form>;
}
