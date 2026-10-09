type RecordValue = Record<string, unknown>;
export function bankingRecord(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reconciliation response.");
  return value as RecordValue;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) throw new Error("Invalid reconciliation identity.");
  return value;
}
function text(value: unknown): string { if (typeof value !== "string") throw new Error("Invalid reconciliation text."); return value; }
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function date(value: unknown): string {
  const input = text(value); const parsed = new Date(`${input}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== input) throw new Error("Invalid reconciliation date.");
  return input;
}
export function bankingCents(value: string): bigint {
  const parsed = /^(-?)(\d{1,18})(?:\.(\d{1,2}))?$/.exec(value);
  if (!parsed) throw new Error("Invalid exact BDT amount.");
  const cents = BigInt(parsed[2]!) * 100n + BigInt((parsed[3] ?? "").padEnd(2,"0"));
  return parsed[1] ? -cents : cents;
}
export function bankingAmount(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute/100n}.${String(absolute%100n).padStart(2,"0")}`;
}
function money(value: unknown): string { return bankingAmount(bankingCents(text(value))); }
function nonnegative(value: unknown): string { const result=money(value); if (bankingCents(result)<0n) throw new Error("Invalid reconciliation capacity."); return result; }
function rows(value: unknown): RecordValue[] { if (!Array.isArray(value)) throw new Error("Invalid reconciliation rows."); return value.map(bankingRecord); }
export type StatementLine = { id:string; row_no:number; transaction_date:string; description:string; reference:string|null; amount:string; matched:string; remaining:string; review_required:boolean };
export type BookLine = { id:string; accounting_date:string; description:string; document_number:string|null; reference:string|null; debit:string; credit:string; signed_amount:string; matched:string; remaining:string };
export type ReconciliationMatch = { id:string; statement_line_id:string; journal_line_id:string; amount:string; reversed:boolean; created_at:string };
export type ReconciliationWorkspaceData = {
  reconciliation:{id:string;organization_id:string;cash_account_id:string;starts_on:string;ends_on:string;statement_opening:string;statement_closing:string;state:"draft"|"finalized";evidence_snapshot:RecordValue|null};
  cash_account:{id:string;name:string;kind:string}; statement_lines:StatementLine[];book_lines:BookLine[];matches:ReconciliationMatch[];
};
export function readReconciliationWorkspace(value: unknown, organizationId:string, reconciliationId:string): ReconciliationWorkspaceData {
  const raw=bankingRecord(value); const session=bankingRecord(raw.reconciliation); const account=bankingRecord(raw.cash_account);
  if(session.id!==reconciliationId || session.organization_id!==organizationId || account.id!==session.cash_account_id || !["draft","finalized"].includes(String(session.state))) throw new Error("Invalid reconciliation scope.");
  const statementLines=rows(raw.statement_lines).map(row=>{
    if(!Number.isSafeInteger(row.row_no)||(row.row_no as number)<1||typeof row.review_required!=="boolean")throw new Error("Invalid statement line.");
    const result={id:id(row.id),row_no:row.row_no as number,transaction_date:date(row.transaction_date),description:text(row.description),reference:nullableText(row.reference),amount:money(row.amount),matched:nonnegative(row.matched),remaining:nonnegative(row.remaining),review_required:row.review_required};
    const total=bankingCents(result.amount);if((total<0n?-total:total)!==bankingCents(result.matched)+bankingCents(result.remaining))throw new Error("Statement capacity does not agree.");
    return result;
  });
  const bookLines=rows(raw.book_lines).map(row=>{
    const result={id:id(row.id),accounting_date:date(row.accounting_date),description:row.description===null?"":text(row.description),document_number:nullableText(row.document_number),reference:nullableText(row.reference),debit:nonnegative(row.debit),credit:nonnegative(row.credit),signed_amount:money(row.signed_amount),matched:nonnegative(row.matched),remaining:nonnegative(row.remaining)};
    const signed=bankingCents(result.signed_amount);if(bankingCents(result.debit)-bankingCents(result.credit)!==signed||(signed<0n?-signed:signed)!==bankingCents(result.matched)+bankingCents(result.remaining))throw new Error("Cashbook capacity does not agree.");
    return result;
  });
  const matches=rows(raw.matches).map(row=>{
    if(typeof row.reversed!=="boolean")throw new Error("Invalid match state.");
    const result={id:id(row.id),statement_line_id:id(row.statement_line_id),journal_line_id:id(row.journal_line_id),amount:nonnegative(row.amount),reversed:row.reversed,created_at:text(row.created_at)};
    if(!statementLines.some(line=>line.id===result.statement_line_id)||!bookLines.some(line=>line.id===result.journal_line_id))throw new Error("Reconciliation match has missing evidence.");
    return result;
  });
  for(const collection of [statementLines,bookLines,matches])if(new Set(collection.map(row=>row.id)).size!==collection.length)throw new Error("Duplicate reconciliation evidence.");
  const starts=date(session.starts_on),ends=date(session.ends_on);if(ends<starts)throw new Error("Invalid reconciliation date range.");
  const storedEvidence=session.evidence_snapshot===null?null:bankingRecord(session.evidence_snapshot);
  const evidence=storedEvidence&&Object.keys(storedEvidence).length?storedEvidence:null;
  if(evidence){for(const key of ["book_closing","adjusted_statement_closing","unexplained_difference"])money(evidence[key]);text(evidence.finalized_at);}
  if(session.state==="finalized"&&!evidence)throw new Error("Finalized reconciliation evidence is missing.");
  return {reconciliation:{id:id(session.id),organization_id:id(session.organization_id),cash_account_id:id(session.cash_account_id),starts_on:starts,ends_on:ends,statement_opening:money(session.statement_opening),statement_closing:money(session.statement_closing),state:session.state as "draft"|"finalized",evidence_snapshot:evidence},cash_account:{id:id(account.id),name:text(account.name),kind:text(account.kind)},statement_lines:statementLines,book_lines:bookLines,matches};
}
export function matchValidation(statement:StatementLine|undefined,book:BookLine|undefined,amount:string,matches:ReconciliationMatch[]): {amount:string|null;error:string} {
  if(!statement||!book)return {amount:null,error:"Choose one statement row and one cashbook entry."};
  if((bankingCents(statement.amount)<0n)!==(bankingCents(book.signed_amount)<0n))return {amount:null,error:"Choose entries with the same direction: both money in or both money out."};
  if(matches.some(match=>!match.reversed&&match.statement_line_id===statement.id&&match.journal_line_id===book.id))return {amount:null,error:"These entries already have an active match. Reverse that match before changing its amount."};
  if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount))return {amount:null,error:"Enter a positive amount with up to two decimal places."};
  const cents=bankingCents(amount); const capacity=bankingCents(statement.remaining)<bankingCents(book.remaining)?bankingCents(statement.remaining):bankingCents(book.remaining);
  if(cents<=0n||cents>capacity)return {amount:null,error:`Enter an amount above zero and no more than BDT ${bankingAmount(capacity)}.`};
  return {amount:bankingAmount(cents),error:""};
}
export function suggestedMatchAmount(statement:StatementLine|undefined,book:BookLine|undefined): string {
  if(!statement||!book||(bankingCents(statement.amount)<0n)!==(bankingCents(book.signed_amount)<0n))return "";
  const a=bankingCents(statement.remaining),b=bankingCents(book.remaining);return bankingAmount(a<b?a:b);
}
export type ReconciliationAction = {kind:"match";statementId:string;bookId:string;amount:string;previousIds:string[]}|{kind:"reverse";matchId:string;reason:string}|{kind:"finalize"}|{kind:"reopen";reason:string};
export function reconciliationActionObserved(action:ReconciliationAction,data:ReconciliationWorkspaceData):boolean {
  if(action.kind==="match")return data.matches.some(match=>!match.reversed&&!action.previousIds.includes(match.id)&&match.statement_line_id===action.statementId&&match.journal_line_id===action.bookId&&match.amount===action.amount);
  if(action.kind==="reverse")return data.matches.some(match=>match.id===action.matchId&&match.reversed);
  if(action.kind==="finalize")return data.reconciliation.state==="finalized";
  return data.reconciliation.state==="draft"&&data.reconciliation.evidence_snapshot!==null;
}
export function validateReconciliationReceipt(action:ReconciliationAction,value:unknown,reconciliationId:string):void {
  const raw=bankingRecord(value);
  if(action.kind==="match")id(raw.id);
  else if(action.kind==="reverse")id(raw.reversal_id);
  else if(action.kind==="reopen")id(raw.reopen_event_id);
  else if(raw.id!==reconciliationId||raw.state!=="finalized"||!raw.evidence||typeof raw.evidence!=="object")throw new Error("The finalization result could not be confirmed.");
}
