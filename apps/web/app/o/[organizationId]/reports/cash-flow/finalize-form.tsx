'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {RecoverableFormRequest,isConfirmedFormRejection,documentActionError} from '../../accounting/documents/document-action-validation.ts';
export function FinalizeCashFlow({organizationId,nonce,from,to,digest,disabled}:{organizationId:string;nonce:string;from:string;to:string;digest:string;disabled:boolean}){
 const router=useRouter(),attempt=useRef(new RecoverableFormRequest()),pending=useRef(false);
 const[busy,setBusy]=useState(false),[retry,setRetry]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState('');
 async function finalize(){if(pending.current||saved)return;const next=attempt.current.begin(JSON.stringify({from,to,expected_digest:digest}));if(!next)return;pending.current=true;setBusy(true);setError('');
  try{const r=await fetch(`/api/v1/organizations/${organizationId}/reports/cash-flow/finalize`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':next.key,'X-Company-Context':nonce},body:next.body}),json=await r.json();
   if(!r.ok){if(isConfirmedFormRejection(r.status,json))attempt.current.rejected();throw new Error(documentActionError(json,'Report could not be finalized.').message);}
   if(typeof json.data?.finalization_id!=='string')throw new Error('Confirmation is incomplete. Retry the same request.');attempt.current.confirmed();setSaved(true);router.push(`?${new URLSearchParams({from,to,finalization:json.data.finalization_id})}`);
  }catch(e){attempt.current.uncertain();setRetry(attempt.current.needsRetry);setError(e instanceof Error?e.message:'Retry to confirm finalization.');}finally{pending.current=false;setBusy(false);}}
 return <div>{error&&<p role="alert">{error}</p>}<button disabled={busy||saved||disabled} onClick={()=>void finalize()}>{busy?'Finalizing…':saved?'Opening finalized snapshot…':retry?'Retry finalization':'Finalize this snapshot'}</button><p>Preserves this report and its cutoff. Later postings require a new review. Recent authentication is required.</p></div>;
}
