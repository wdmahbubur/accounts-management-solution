import NewDraftPage from "../../documents/new/new-draft-page.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function NewJournalPage({params}:{params:Promise<{organizationId:string}>}){return NewDraftPage({params,searchParams:Promise.resolve({type:"manual_journal"})});}
