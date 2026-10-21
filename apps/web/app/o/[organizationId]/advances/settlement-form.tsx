'use client';
import { useEffect,useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { moneyUnits } from '@ams/accounting';
import type { SettlementOptions } from '../../../../server/documents/linked-settlements.ts';
import { RecoverableFormRequest,isConfirmedFormRejection,documentActionError } from '../accounting/documents/document-action-validation.ts';
import { canonicalAmountInput } from '../accounting/documents/draft-calculations.ts';
import { PostingPreview } from '../../../../components/finance/posting-preview.tsx';
import { parsePostingPreviewResult,type PostingPreviewResult } from '../../../../lib/posting-preview.ts';
import styles from './settlements.module.css';

export function SettlementForm({organizationId,nonce,options,cashAccounts,initial,mode,initialSide='customer'}:{organizationId:string;nonce:string;options:SettlementOptions;cashAccounts:{id:string;name:string}[];initial?:Record<string,unknown>;mode?:string;initialSide?:string}) {
  const router=useRouter(),request=useRef(new RecoverableFormRequest()),pending=useRef(false),confirmed=useRef(false);
  const linked=(initial?.linked_settlement??{}) as Record<string,unknown>;
  const [type,setType]=useState(String(initial?.document_type??(mode==='refund'?`${initialSide}_refund`:'advance_application')));
  const [side,setSide]=useState(options.sources.find(s=>s.id===linked.source_open_item_id)?.control_kind==='vendor_advance'?'vendor':initialSide);const [source,setSource]=useState(String(linked.source_open_item_id??''));
  const [busy,setBusy]=useState(false),[retry,setRetry]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(!retry)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[retry]);
  const sources=options.sources.filter(s=>!s.reversed&&(moneyUnits(s.remaining_amount)>0n||s.id===source)&&
    (type==='advance_application'?s.control_kind===(side==='customer'?'customer_advance':'vendor_advance'):type==='customer_refund'?['ar','customer_advance'].includes(s.control_kind):['ap','vendor_advance'].includes(s.control_kind)));
  const selected=sources.find(s=>s.id===source);
  const targets=options.targets.filter(t=>t.party_id===selected?.party_id&&t.control_kind===(selected?.control_kind==='customer_advance'?'ar':'ap'));
  async function save(form:HTMLFormElement){
    if(pending.current||confirmed.current)return;
    let attempt;
    try {
      if(retry)attempt=request.current.begin('');
      else {const data=new FormData(form),amount=canonicalAmountInput(String(data.get('amount')));
        if(!selected||moneyUnits(amount)<=0n||moneyUnits(amount)>moneyUnits(selected.remaining_amount))throw new Error('Choose an eligible balance and an amount within its remaining balance.');
        attempt=request.current.begin(JSON.stringify({document_id:initial?.id??null,expected_version:initial?.version??null,payload:{document_type:type,source_open_item_id:source,target_open_item_id:type==='advance_application'?data.get('target'):null,
          accounting_date:options.effective_date,amount,description:data.get('description'),...(type==='advance_application'?{}:{cash_account_id:data.get('cash'),reference:data.get('reference'),cash_flow_class:data.get('classification'),method:data.get('method')})}}));}
      if(!attempt)return;
    }catch(e){setError(e instanceof Error?e.message:'Check the form.');return;}
    pending.current=true;setBusy(true);setError('');
    try {const response=await fetch(`/api/v1/organizations/${organizationId}/linked-settlements`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':attempt.key,'X-Request-Id':`settlement-${crypto.randomUUID()}`,'X-Company-Context':nonce},body:attempt.body});
      const json=await response.json();if(!response.ok){if(isConfirmedFormRejection(response.status,json))request.current.rejected();throw new Error(documentActionError(json,'Draft could not be saved.').message);}
      if(typeof json.data?.documentId!=='string')throw new Error('Draft confirmation is incomplete. Retry the same request.');
      request.current.confirmed();confirmed.current=true;setSaved(true);setRetry(false);router.push(`/o/${organizationId}/accounting/documents/${json.data.documentId}`);
    }catch(e){request.current.uncertain();setRetry(request.current.needsRetry);setError(e instanceof Error?e.message:'Save could not be confirmed. Retry the same request.');}
    finally{pending.current=false;setBusy(false);}
  }
  return <section className="panel"><h2>{initial?'Edit settlement':'Apply or refund'}</h2>
    {error&&<p role="alert">{error}</p>}
    <form className={styles.form} onSubmit={e=>{e.preventDefault();void save(e.currentTarget);}}>
      <fieldset className={styles.fields} disabled={busy||retry||saved}><legend>Settlement details</legend>
        <label>Action<select value={type} disabled={!!initial} onChange={e=>{setType(e.target.value);setSource('');}}><option value="advance_application">Apply advance</option><option value="customer_refund">Customer refund</option><option value="vendor_refund">Supplier refund</option></select></label>
        {type==='advance_application'&&<label>Advance type<select value={side} onChange={e=>{setSide(e.target.value);setSource('');}}><option value="customer">Customer</option><option value="vendor">Supplier</option></select></label>}
        <label>Eligible balance<select required value={source} onChange={e=>setSource(e.target.value)}><option value="">Choose a balance</option>{sources.map(s=><option key={s.id} value={s.id}>{s.party_name} · {s.document_type==='opening_balance'?s.reference:s.document_number} · BDT {s.remaining_amount} · {s.control_kind.replaceAll('_',' ')}</option>)}</select></label>
        {!sources.length&&<p role="status">No eligible balances for this date.</p>}
        {type==='advance_application'?<label>Invoice or bill<select name="target" key={source} required defaultValue={String(linked.target_open_item_id??'')}><option value="">Choose a target</option>{targets.map(t=><option value={t.id} key={t.id}>{t.document_type==='opening_balance'?t.reference:t.document_number} · BDT {t.remaining_amount}</option>)}</select></label>:<>
          <label>Cash or bank account<select name="cash" required defaultValue={String((initial?.movement as Record<string,unknown>)?.cash_account_id??'')}><option value="">Choose account</option>{cashAccounts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Cash classification<select name="classification" required defaultValue={String((initial?.movement as Record<string,unknown>)?.cash_flow_class??'')}><option value="">Choose classification</option><option value="operating">Operating</option><option value="investing">Investing</option><option value="financing">Financing</option></select></label>
          <label>Payment method<select name="method" required defaultValue={String((initial?.movement as Record<string,unknown>)?.method??'')}><option value="">Choose method</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="mobile_wallet">Mobile wallet</option><option value="card">Card</option><option value="other">Other</option></select></label>
          <label>Payment reference<input name="reference" required maxLength={160} defaultValue={String(initial?.external_reference??'')}/></label>
        </>}
        <label>Amount · BDT<input name="amount" inputMode="decimal" required defaultValue={String(linked.amount??'')} /></label>
        <label>Description<input name="description" required maxLength={500} defaultValue={String(initial?.description??'')}/></label>
      </fieldset>
      <div className="actions"><button type="submit" disabled={busy||saved||(!retry&&!selected)}>{busy?'Saving…':saved?'Opening draft…':retry?'Retry save':'Save draft'}</button><Link className="secondary" href={`/o/${organizationId}/advances`}>Cancel</Link></div>
      <p role="status">{saved?'Draft saved. Opening review…':retry?'Save confirmation needed. Retry the same request.':'Draft only · review and approve before posting'}</p>
    </form>
  </section>;
}

export function SettlementReview({organizationId,documentId,version,canSubmit}:{organizationId:string;documentId:string;version:number;canSubmit:boolean}){
  const router=useRouter(),keys=useRef({preview:crypto.randomUUID(),submit:crypto.randomUUID()}),pending=useRef(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<PostingPreviewResult|null>(null);
  async function run(action:'preview'|'submit'){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try{const r=await fetch(`/api/v1/organizations/${organizationId}/documents/${documentId}/${action==='preview'?'preview-posting':'submit'}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':keys.current[action]},body:JSON.stringify({expected_version:version})});
      const json=await r.json();if(!r.ok)throw new Error(documentActionError(json,'Settlement could not be reviewed.').message);
      if(action==='preview')setPreview(parsePostingPreviewResult(json.data));else router.refresh();
    }catch(e){setError(e instanceof Error?e.message:'Request could not be confirmed. Retry to check.');}finally{pending.current=false;setBusy(false);}
  }
  return <section className="panel"><h2>Review settlement</h2>{error&&<p role="alert">{error}</p>}{preview&&<PostingPreview result={preview}/>}
    <div className="actions"><button className="secondary" disabled={busy} onClick={()=>void run('preview')}>Preview posting</button>{canSubmit&&<button disabled={busy||!preview} onClick={()=>void run('submit')}>Submit for approval</button>}</div></section>;
}
