export type PendingOpeningSave = { key: string; body: string };
export function parsePendingOpeningSave(raw: string | null): PendingOpeningSave | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value?.key !== "string" || !/^[0-9a-f-]{36}$/i.test(value.key) || typeof value.body !== "string") return null;
    const body = JSON.parse(value.body);
    if (body?.draft?.document_type !== "opening_balance" || !Array.isArray(body.prior_trial_balance)) return null;
    return { key: value.key, body: value.body };
  } catch { return null; }
}

export function recoverOpeningFields(request: PendingOpeningSave, accounts: {id:string;control_kind:string|null}[]) {
  const body = JSON.parse(request.body);
  if (!Array.isArray(body.draft?.journal_rows) || typeof body.evidence_reference !== "string") throw new Error("The saved opening request cannot be restored.");
  const balances: Record<string,{debit:string;credit:string}> = {};
  const details: {id:string;account_id:string;party_id:string;reference:string;due_date:string;debit:string;credit:string}[] = [];
  for (const [index,row] of body.draft.journal_rows.entries()) {
    const account = accounts.find(account => account.id === row.account_id);
    if (!account || ![row.debit,row.credit].every(value => typeof value === "string" && /^(0|[1-9]\d*)\.\d{2}$/.test(value))) throw new Error("The saved request includes an unavailable account or invalid amount. Its original request has been retained.");
    if (account.control_kind) details.push({id:String(index),account_id:row.account_id,party_id:row.party_id,reference:row.open_item_reference,due_date:row.open_item_due_date,debit:row.debit,credit:row.credit});
    else { if (balances[account.id]) throw new Error("The saved request contains duplicate account rows. Its original request has been retained."); balances[account.id]={debit:row.debit,credit:row.credit}; }
  }
  return { balances, details, evidence: body.evidence_reference as string };
}
