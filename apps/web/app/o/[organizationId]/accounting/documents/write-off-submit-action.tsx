"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
export function WriteOffSubmitAction({organizationId,documentId,version}:{organizationId:string;documentId:string;version:number}){
 const router=useRouter();const key=useRef(crypto.randomUUID());const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 async function submit(){setBusy(true);setError("");try{const r=await fetch(`/api/v1/organizations/${organizationId}/documents/${documentId}/submit`,{method:"POST",headers:{"Content-Type":"application/json","X-Request-Id":`write-off-submit-${crypto.randomUUID()}`,"Idempotency-Key":key.current},body:JSON.stringify({expected_version:version})});const body=await r.json();if(!r.ok)throw new Error(body?.error?.message??"The write-off could not be submitted.");key.current=crypto.randomUUID();router.refresh();}catch(e){setError(e instanceof Error?e.message:"The write-off could not be submitted.");}finally{setBusy(false);}}
 return <section className="panel"><h2>Submit write-off for approval</h2><p>The approval request is bound to this draft version and its source digest.</p>{error&&<p role="alert">{error}</p>}<button disabled={busy} onClick={()=>void submit()}>{busy?"Submitting…":"Submit for approval"}</button></section>;
}
