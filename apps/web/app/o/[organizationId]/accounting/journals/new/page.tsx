import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../../server/commands/errors.ts";
import { readDraftOptions } from "../../../../../../server/documents/service.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import type { SourceType } from "../../../../../../server/documents/contracts.ts";
import { DraftEditor, type DraftOptions } from "../../documents/draft-editor.tsx";
export const dynamic="force-dynamic"; export const revalidate=0;
export default async function NewJournalPage({params}:{params:Promise<{organizationId:string}>}) {
  let organizationId; try { organizationId=parseOrganizationId((await params).organizationId); } catch { redirect("/companies?error=not_found"); }
  const runtime=await roleRuntime(); if(!runtime.current||runtime.current.organizationId!==organizationId) redirect("/companies?error=context_mismatch");
  try { const actor=await resolveActorContext(organizationId,runtime.dependencies); if(!actor.capabilities.includes("journal.write")) throw CommandError.forbidden(); const date=new Date().toISOString().slice(0,10), raw=await readDraftOptions(runtime.client,actor,"manual_journal",date);
    const options={accounts:Array.isArray(raw.accounts)?raw.accounts as DraftOptions["accounts"]:[],parties:[],cash_accounts:[],rounding_accounts:[],tax_codes:[],items:[],cost_centers:Array.isArray(raw.cost_centers)?raw.cost_centers as DraftOptions["cost_centers"]:[]};
    return <DraftEditor organizationId={organizationId} nonce={runtime.current.nonce} documentType={"manual_journal" as SourceType} options={options} journalWorkspace/>
  } catch(error) { if(error instanceof CommandError&&error.code==="UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies"); if(error instanceof CommandError&&error.code==="FORBIDDEN") return <main className="content"><h1>Access denied</h1><p>You need journal.write to create a manual journal.</p></main>; throw error; }
}
