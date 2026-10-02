import NewDraftPage from "../../../accounting/documents/new/new-draft-page.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function NewSupplierBillPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{party_id?:string;copy?:string}>}){
 const q=await searchParams;return NewDraftPage({params,searchParams:Promise.resolve({type:"bill",party_id:q.party_id,copy:q.copy})});
}
