import { parseUuid, type Uuid } from "@ams/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";

export interface JournalRegisterRow { journalEntryId: Uuid; sourceDocumentId: Uuid; documentNumber: string; sourceType: string; accountingDate: string; memo: string; periodLabel: string; creator: string; debitTotal: string; creditTotal: string; accounts: string; reversalDocumentId: Uuid | null; reversalDate: string | null; reversalJournalEntryId: Uuid | null; reversesDocumentId: Uuid | null; reversesJournalEntryId: Uuid | null; }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid journal response."); return value as Record<string, unknown>; }
export async function readJournalRegister(client: Pick<SupabaseClient,"rpc">, actor: ActorContext, filters: {account?: string;source?: string;period?: string}): Promise<JournalRegisterRow[]> {
  if (!actor.capabilities.includes("ledger.read")) throw CommandError.forbidden();
  const result = await client.rpc("read_journal_register", { p_organization_id: actor.organizationId, p_account_query: filters.account || null, p_source_query: filters.source || null, p_period_query: filters.period || null, p_limit: 100 });
  if (result.error) { if (result.error.code === "42501") throw CommandError.forbidden(); throw new CommandError({code:"INTERNAL_ERROR"}); }
  if (!Array.isArray(result.data)) throw new Error("Invalid journal register response.");
  return result.data.map((value) => { const row=record(value); if (row.source_type === undefined || row.accounting_date === undefined || row.document_number === null || row.document_number === undefined) throw new Error("Invalid journal register row.");
    return {journalEntryId:parseUuid(row.journal_entry_id),sourceDocumentId:parseUuid(row.source_document_id),documentNumber:String(row.document_number),sourceType:String(row.source_type),accountingDate:String(row.accounting_date),memo:String(row.memo??""),periodLabel:String(row.period_label),creator:String(row.creator),debitTotal:String(row.debit_total),creditTotal:String(row.credit_total),accounts:String(row.accounts??""),reversalDocumentId:row.reversal_document_id?parseUuid(row.reversal_document_id):null,reversalDate:row.reversal_date?String(row.reversal_date):null,reversalJournalEntryId:row.reversal_journal_entry_id?parseUuid(row.reversal_journal_entry_id):null,reversesDocumentId:row.reverses_document_id?parseUuid(row.reverses_document_id):null,reversesJournalEntryId:row.reverses_journal_entry_id?parseUuid(row.reverses_journal_entry_id):null}; });
}
export async function readJournalRegisterDetail(client: Pick<SupabaseClient,"rpc">, actor: ActorContext, journalId: Uuid) {
  const result=await client.rpc("read_journal_register_detail",{p_organization_id:actor.organizationId,p_journal_entry_id:journalId});
  if(result.error){if(result.error.code==="P0002")throw CommandError.notFound();if(result.error.code==="42501")throw CommandError.forbidden();throw new CommandError({code:"INTERNAL_ERROR"});}
  return record(result.data);
}
