import NewDraftPage from "../../../accounting/documents/new/new-draft-page.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function NewReceiptPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{party_id?:string}>}){const q=await searchParams;return NewDraftPage({params,searchParams:Promise.resolve({type:"receipt",party_id:q.party_id})});}
