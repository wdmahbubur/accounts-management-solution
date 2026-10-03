"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
type Item={kind:"approval"|"delivery_failure"|"export_failure"|"invoice_due"|"bill_due";id:string;title:string;detail:string;occurred_at:string;is_read:boolean;document_id:string|null};
export function NotificationList({organizationId,items,canRetryDeliveries}:{organizationId:string;items:Item[];canRetryDeliveries:boolean}){
  const router=useRouter();const [busy,setBusy]=useState<string|null>(null);const [error,setError]=useState("");const [notice,setNotice]=useState("");const [retried,setRetried]=useState<string[]>([]);
  async function markRead(item:Item){setBusy(item.id);setError("");try{const response=await fetch(`/api/v1/organizations/${organizationId}/notifications/${item.kind}/${item.id}/read`,{method:"POST"});
    const body=await response.json();if(!response.ok)throw new Error(body?.error?.message??"Could not update notification state.");router.refresh();
  }catch(caught){setError(caught instanceof Error?caught.message:"Could not update notification state.");}finally{setBusy(null);}}
  async function retryDelivery(item:Item){if(!item.document_id)return;setBusy(item.id);setError("");setNotice("");const requestId=crypto.randomUUID();try{
    const response=await fetch(`/api/v1/organizations/${organizationId}/documents/${item.document_id}/send`,{method:"POST",headers:{"X-Request-Id":`notification-retry-${requestId}`,"Idempotency-Key":item.id}});
    const body=await response.json();if(!response.ok)throw new Error(body?.error?.fields?.invoice??body?.error?.message??"Delivery could not be retried.");
    setRetried(current=>[...current,item.id]);setNotice("The delivery retry is recorded. Invoice posting was not changed.");
    const read=await fetch(`/api/v1/organizations/${organizationId}/notifications/${item.kind}/${item.id}/read`,{method:"POST"});if(read.ok)router.refresh();
  }catch(caught){setError(caught instanceof Error?caught.message:"Delivery could not be retried.");}finally{setBusy(null);}}
  if(!items.length)return <section className="panel"><p>No notifications need attention.</p></section>;
  return <section className="panel" aria-label="Notifications">{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}<ul>
    {items.map((item)=><li key={`${item.kind}:${item.id}`} style={{padding:"1rem 0",borderBottom:"1px solid var(--border,#ddd)"}}>
      <p><strong>{item.title}</strong> {item.is_read&&<span>(Read)</span>}</p><p>{item.detail}</p>
      <p><time dateTime={item.occurred_at}>{new Date(item.occurred_at).toLocaleString("en-BD",{timeZone:"Asia/Dhaka"})}</time></p>
      {item.document_id?<Link href={`/o/${organizationId}/accounting/documents/${item.document_id}`}>Open authorized document</Link>:<Link href={`/o/${organizationId}/exports`}>Open exports</Link>}
      {item.kind==="delivery_failure"&&item.document_id&&canRetryDeliveries&&!item.is_read&&!retried.includes(item.id)&&<button type="button" className="secondary" disabled={busy!==null} onClick={()=>void retryDelivery(item)}>{busy===item.id?"Queueing retry…":"Retry email delivery"}</button>}
      {!item.is_read&&<button type="button" className="secondary" disabled={busy!==null} onClick={()=>void markRead(item)}>{busy===item.id?"Saving…":"Mark read"}</button>}
    </li>)}</ul></section>;
}
