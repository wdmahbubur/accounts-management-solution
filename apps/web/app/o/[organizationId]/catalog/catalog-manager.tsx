"use client";
import {useEffect,useRef,useState} from "react";
import styles from "./catalog.module.css";
import finance from "../../../../components/finance/finance.module.css";
type Account={id:string;code:string;name:string;account_type:string};
type Tax={id:string;code:string;label:string;rate_percent:string;effective_from:string;effective_to:string|null};
type Item={id:string;sku:string|null;name:string;unit:string;default_unit_price:string;sales_account_id:string|null;purchase_account_id:string|null;tax_code_id:string|null;is_active:boolean;row_version:number};
type Center={id:string;code:string;name:string;is_active:boolean;row_version:number};
export type CatalogData={items:Item[];cost_centers:Center[];accounts:Account[];tax_codes:Tax[]};
const emptyItem=()=>({sku:"",name:"",unit:"unit",default_unit_price:"0.00",sales_account_id:"",purchase_account_id:"",tax_code_id:"",is_active:true});
const emptyCenter=()=>({code:"",name:"",is_active:true});
export function CatalogManager({organizationId,data,centers,canWrite}:{organizationId:string;data:CatalogData;centers:boolean;canWrite:boolean}){
 const [items,setItems]=useState(data.items);const [costCenters,setCostCenters]=useState(data.cost_centers);const [selectedItem,setSelectedItem]=useState<Item|null>(null);const [selectedCenter,setSelectedCenter]=useState<Center|null>(null);const [item,setItem]=useState(emptyItem);const [center,setCenter]=useState(emptyCenter);const [itemOpen,setItemOpen]=useState(false);const [centerOpen,setCenterOpen]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const idem=useRef(crypto.randomUUID());
 function editItem(row:Item|null){setSelectedItem(row);setItem(row?{sku:row.sku??"",name:row.name,unit:row.unit,default_unit_price:row.default_unit_price,sales_account_id:row.sales_account_id??"",purchase_account_id:row.purchase_account_id??"",tax_code_id:row.tax_code_id??"",is_active:row.is_active}:emptyItem());setItemOpen(true);setError("");}
 function editCenter(row:Center|null){setSelectedCenter(row);setCenter(row?{code:row.code,name:row.name,is_active:row.is_active}:emptyCenter());setCenterOpen(true);setError("");}
 async function submitItem(event:React.FormEvent){event.preventDefault();if(!item.sales_account_id&&!item.purchase_account_id){setError("Choose a revenue or purchase account default.");return;}setBusy(true);setError("");try{const response=await fetch(`/api/v1/organizations/${organizationId}/catalog/items${selectedItem?`/${selectedItem.id}`:""}`,{method:selectedItem?"PATCH":"POST",headers:{"Content-Type":"application/json","X-Request-Id":`catalog-item-${crypto.randomUUID()}`,"Idempotency-Key":idem.current},body:JSON.stringify({expected_version:selectedItem?.row_version??null,item:{...item,sku:item.sku.trim()||null,sales_account_id:item.sales_account_id||null,purchase_account_id:item.purchase_account_id||null,tax_code_id:item.tax_code_id||null}})});const body=await response.json();if(!response.ok)throw new Error(body?.error?.fields?.catalog??body?.error?.fields?.duplicate??body?.error?.message??"Item could not be saved.");const saved=body.data as Item;setItems(old=>[...old.filter(x=>x.id!==saved.id),saved].sort((a,b)=>a.name.localeCompare(b.name)));setSelectedItem(null);setItem(emptyItem());setItemOpen(false);idem.current=crypto.randomUUID();}catch(e){setError(e instanceof Error?e.message:"Item could not be saved.");}finally{setBusy(false);}}
 async function submitCenter(event:React.FormEvent){event.preventDefault();setBusy(true);setError("");try{const response=await fetch(`/api/v1/organizations/${organizationId}/catalog/cost-centers${selectedCenter?`/${selectedCenter.id}`:""}`,{method:selectedCenter?"PATCH":"POST",headers:{"Content-Type":"application/json","X-Request-Id":`cost-center-${crypto.randomUUID()}`,"Idempotency-Key":idem.current},body:JSON.stringify({expected_version:selectedCenter?.row_version??null,cost_center:center})});const body=await response.json();if(!response.ok)throw new Error(body?.error?.fields?.catalog??body?.error?.fields?.duplicate??body?.error?.message??"Cost center could not be saved.");const saved=body.data as Center;setCostCenters(old=>[...old.filter(x=>x.id!==saved.id),saved].sort((a,b)=>a.code.localeCompare(b.code)));setSelectedCenter(null);setCenter(emptyCenter());setCenterOpen(false);idem.current=crypto.randomUUID();}catch(e){setError(e instanceof Error?e.message:"Cost center could not be saved.");}finally{setBusy(false);}}
 const formHeading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{formHeading.current?.focus();},[itemOpen,centerOpen,selectedItem,selectedCenter]);
 return <section className={`panel ${finance.register}`}>
   <div className={finance.listHeading}><div><h2>{centers?"Cost centers":"Service and non-stock items"}</h2><p>{centers?`${costCenters.length} saved cost centers`:`${items.length} saved items · rates in BDT`}</p></div>
     {canWrite&&<button type="button" disabled={busy} onClick={()=>centers?editCenter(null):editItem(null)}>{centers?"New cost center":"New item"}</button>}
   </div>
   {centers?<>
     {canWrite&&centerOpen&&<form className={styles.form} onSubmit={submitCenter} aria-busy={busy}>
       <h3 tabIndex={-1} ref={formHeading}>{selectedCenter?"Edit cost center":"New cost center"}</h3>
       <p className={styles.hint}>Code and name lock after first use to keep earlier reporting consistent.</p>
       <fieldset disabled={busy} className={styles.fields}><legend className={styles.visuallyHidden}>Cost center details</legend><div className={styles.grid}>
         <label>Code<input maxLength={32} required value={center.code} onChange={e=>setCenter({...center,code:e.target.value})}/></label>
         <label>Name<input maxLength={120} required value={center.name} onChange={e=>setCenter({...center,name:e.target.value})}/></label>
         {selectedCenter&&<label className={styles.check}><input type="checkbox" checked={center.is_active} onChange={e=>setCenter({...center,is_active:e.target.checked})}/> Active cost center</label>}
       </div></fieldset>
       {error&&<p className={styles.error} role="alert">{error}</p>}
       <div className={styles.formFooter}><button disabled={busy}>{busy?"Saving…":"Save cost center"}</button><button type="button" className="secondary" disabled={busy} onClick={()=>{setCenterOpen(false);setSelectedCenter(null);}}>Cancel</button></div>
     </form>}
     {costCenters.length===0?<p className={finance.empty}>No cost centers yet. Add one to group transactions in management reports.</p>:<div className={`table-scroll ${finance.scroll}`} tabIndex={0} role="region" aria-label="Cost centers"><table>
       <thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Status</th>{canWrite&&<th scope="col">Action</th>}</tr></thead>
       <tbody>{costCenters.map(row=><tr key={row.id}><th scope="row">{row.code}</th><td>{row.name}</td><td><span className={finance.badge}>{row.is_active?"Active":"Archived"}</span></td>{canWrite&&<td><button type="button" className="secondary" disabled={busy} aria-label={`Edit cost center ${row.name}`} onClick={()=>editCenter(row)}>Edit</button></td>}</tr>)}</tbody>
     </table></div>}
   </>:<>
     {canWrite&&itemOpen&&<form className={styles.form} onSubmit={submitItem} aria-busy={busy}>
       <h3 tabIndex={-1} ref={formHeading}>{selectedItem?"Edit item":"New service or non-stock item"}</h3>
       <p className={styles.hint}>Defaults are copied into new drafts, where they can still be edited. Saved documents keep their own details.</p>
       <fieldset disabled={busy} className={styles.fields}><legend className={styles.visuallyHidden}>Item details</legend>
         <div className={styles.grid}>
           <label>Name<input required maxLength={160} value={item.name} onChange={e=>setItem({...item,name:e.target.value})}/></label>
           <label>SKU (optional)<input maxLength={80} value={item.sku} onChange={e=>setItem({...item,sku:e.target.value})}/></label>
           <label>Unit<input required maxLength={40} value={item.unit} onChange={e=>setItem({...item,unit:e.target.value})}/></label>
           <label>Default selling rate (BDT)<input required inputMode="decimal" pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?" value={item.default_unit_price} onChange={e=>setItem({...item,default_unit_price:e.target.value})}/><span className={styles.hint}>Up to 6 decimal places.</span></label>
         </div>
         <section className={styles.defaults}><h4>Account and tax defaults</h4><p className={styles.hint}>Choose at least one revenue or purchase account.</p><div className={styles.grid}>
           <label>Revenue account<select value={item.sales_account_id} onChange={e=>setItem({...item,sales_account_id:e.target.value})}><option value="">None</option>{data.accounts.filter(a=>a.account_type==="income").map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
           <label>Purchase / expense account<select value={item.purchase_account_id} onChange={e=>setItem({...item,purchase_account_id:e.target.value})}><option value="">None</option>{data.accounts.filter(a=>a.account_type==="expense"||a.account_type==="asset").map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
           <label>Default tax code<select value={item.tax_code_id} onChange={e=>setItem({...item,tax_code_id:e.target.value})}><option value="">None</option>{data.tax_codes.map(t=><option key={t.id} value={t.id}>{t.code} · {t.label} ({t.rate_percent}%) · from {t.effective_from}</option>)}</select></label>
           {selectedItem&&<label className={styles.check}><input type="checkbox" checked={item.is_active} onChange={e=>setItem({...item,is_active:e.target.checked})}/> Active item</label>}
         </div></section>
       </fieldset>
       {error&&<p className={styles.error} role="alert">{error}</p>}
       <div className={styles.formFooter}><button disabled={busy}>{busy?"Saving…":"Save item"}</button><button type="button" className="secondary" disabled={busy} onClick={()=>{setItemOpen(false);setSelectedItem(null);}}>Cancel</button></div>
     </form>}
     {items.length===0?<p className={finance.empty}>No catalogue items yet. Add a service or non-stock item to reuse its details in drafts.</p>:<div className={`table-scroll ${finance.scroll}`} tabIndex={0} role="region" aria-label="Service and non-stock catalogue"><table>
       <thead><tr><th scope="col">Item</th><th scope="col" className={finance.amount}>Selling rate</th><th scope="col">Revenue account</th><th scope="col">Purchase account</th><th scope="col">Tax</th><th scope="col">Status</th>{canWrite&&<th scope="col">Action</th>}</tr></thead>
       <tbody>{items.map(row=><tr key={row.id}><th scope="row">{row.name}{row.sku&&<span className={finance.meta}>SKU: {row.sku}</span>}</th><td className={finance.amount}>{row.default_unit_price}<span className={finance.meta}>per {row.unit}</span></td><td>{labelFor(data.accounts,row.sales_account_id)}</td><td>{labelFor(data.accounts,row.purchase_account_id)}</td><td>{labelTax(data.tax_codes,row.tax_code_id)}</td><td><span className={finance.badge}>{row.is_active?"Active":"Archived"}</span></td>{canWrite&&<td><button type="button" className="secondary" disabled={busy} aria-label={`Edit item ${row.name}`} onClick={()=>editItem(row)}>Edit</button></td>}</tr>)}</tbody>
     </table></div>}
   </>}
 </section>;
}
function labelFor(accounts:Account[],id:string|null){const account=accounts.find(a=>a.id===id);return account?`${account.code} · ${account.name}`:id??"—";}
function labelTax(codes:Tax[],id:string|null){const tax=codes.find(t=>t.id===id);return tax?`${tax.code} · ${tax.label}`:id??"—";}
