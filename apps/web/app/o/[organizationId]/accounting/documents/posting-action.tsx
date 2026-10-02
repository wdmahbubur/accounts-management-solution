"use client";
import { useRef,useState } from "react";
import { useRouter } from "next/navigation";

export function PostingAction({organizationId,documentId,version}:{organizationId:string;documentId:string;version:number}){
  const router=useRouter();const key=useRef(crypto.randomUUID());const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function post(){setBusy(true);setError("");try{const response=await fetch(`/api/v1/organizations/${organizationId}/documents/${documentId}/post`,{method:"POST",headers:{"Content-Type":"application/json","X-Request-Id":`document-post-${crypto.randomUUID()}`,"Idempotency-Key":key.current},body:JSON.stringify({expected_version:version})});
      const json=await response.json();if(!response.ok)throw new Error(json?.error?.message??"The approved source could not be posted.");key.current=crypto.randomUUID();router.refresh();
    }catch(caught){setError(caught instanceof Error?caught.message:"The approved source could not be posted.");}finally{setBusy(false);}}
  return <section className="panel"><h2>Post approved source</h2><p>Posting rechecks the approval, current permissions, accounting period, mappings and settlement capacity in one database transaction.</p>
    {error&&<p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={()=>void post()}>{busy?"Posting…":"Post to ledger"}</button></section>;
}
