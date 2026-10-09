import assert from "node:assert/strict";
import test from "node:test";
import { bankingAmount, bankingCents, matchValidation, readReconciliationWorkspace, reconciliationActionObserved, suggestedMatchAmount, validateReconciliationReceipt, type ReconciliationAction } from "../../apps/web/lib/reconciliation-workspace.ts";

const organizationId = "a845a9f5-773d-45ee-aaca-824f2ee43001";
const reconciliationId = "a845a9f5-773d-45ee-aaca-824f2ee43002";
const accountId = "a845a9f5-773d-45ee-aaca-824f2ee43003";
const statementId = "a845a9f5-773d-45ee-aaca-824f2ee43004";
const bookId = "a845a9f5-773d-45ee-aaca-824f2ee43005";
const matchId = "a845a9f5-773d-45ee-aaca-824f2ee43006";
const receiptId = "a845a9f5-773d-45ee-aaca-824f2ee43007";
const fixture = () => ({
  reconciliation: { id: reconciliationId, organization_id: organizationId, cash_account_id: accountId, starts_on: "2026-10-01", ends_on: "2026-10-31", statement_opening: "0.00", statement_closing: "100.01", state: "draft", evidence_snapshot: {} },
  cash_account: { id: accountId, name: "Synthetic bank", kind: "bank" },
  statement_lines: [{ id: statementId, row_no: 2, transaction_date: "2026-10-09", description: "Synthetic deposit", reference: null, amount: "100.01", matched: "20.00", remaining: "80.01", review_required: false }],
  book_lines: [{ id: bookId, accounting_date: "2026-10-09", description: null, document_number: "RCPT-000001", reference: null, debit: "100.01", credit: "0.00", signed_amount: "100.01", matched: "20.00", remaining: "80.01" }],
  matches: [{ id: matchId, statement_line_id: statementId, journal_line_id: bookId, amount: "20.00", reversed: false, created_at: "2026-10-09T10:00:00Z" }],
});
const read = (value: unknown = fixture()) => readReconciliationWorkspace(value, organizationId, reconciliationId);

test("reconciliation money stays exact above JavaScript's safe integer and preserves signed cents", () => {
  for (const value of ["999999999999999999.99", "9007199254740993.19", "-9007199254740993.19", "-0.01", "0.00", "80.01"]) assert.equal(bankingAmount(bankingCents(value)), value);
  assert.equal(bankingAmount(bankingCents("100") - bankingCents("20.01")), "79.99");
  assert.throws(() => bankingCents("1e3"));
  assert.throws(() => bankingCents("1.001"));
});

test("workspace accepts the real SQL nullable fields and retains active and reversed history", () => {
  const raw = fixture(); raw.matches.push({ ...raw.matches[0]!, id: receiptId, reversed: true });
  const before = structuredClone(raw), result = read(raw);
  assert.equal(result.book_lines[0]!.description, "");
  assert.equal(result.statement_lines[0]!.remaining, "80.01");
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[1]!.reversed, true);
  assert.equal(result.reconciliation.evidence_snapshot, null);
  assert.deepEqual(raw, before);
});

test("workspace rejects foreign scope, numeric money, impossible dates and inconsistent capacity", () => {
  const raw = fixture();
  for (const change of [{ organization_id: accountId }, { id: accountId }, { cash_account_id: bookId }, { starts_on: "2026-02-30" }, { statement_closing: 100.01 }, { state: "finalized" }]) assert.throws(() => read({ ...raw, reconciliation: { ...raw.reconciliation, ...change } }));
  for (const change of [{ remaining: "80.02" }, { matched: "-1.00" }, { amount: 100.01 }, { transaction_date: "2026-13-01" }]) assert.throws(() => read({ ...raw, statement_lines: [{ ...raw.statement_lines[0], ...change }] }));
  assert.throws(() => read({ ...raw, book_lines: [{ ...raw.book_lines[0], signed_amount: "99.00" }] }));
  assert.throws(() => read({ ...raw, matches: [{ ...raw.matches[0], journal_line_id: accountId }] }));
});

test("partial matching uses the smaller remaining capacity and requires a matching money direction", () => {
  const data = read(), statement = data.statement_lines[0]!, book = { ...data.book_lines[0]!, remaining: "30.01" };
  assert.equal(suggestedMatchAmount(statement, book), "30.01");
  assert.deepEqual(matchValidation(statement, book, "30.01", []), { amount: "30.01", error: "" });
  assert.deepEqual(matchValidation(statement, book, "0.1", []), { amount: "0.10", error: "" });
  for (const amount of ["0", "-1.00", "30.02", "1e1", "1.001"]) assert.ok(matchValidation(statement, book, amount, []).error);
  assert.match(matchValidation(statement, { ...book, signed_amount: "-100.01" }, "1.00", []).error, /same direction/);
  assert.equal(suggestedMatchAmount(statement, { ...book, signed_amount: "-100.01" }), "");
  assert.ok(matchValidation(undefined, book, "1.00", []).error);
});

test("active pairs cannot be silently replaced while a reversed pair can be matched again", () => {
  const data = read(), statement = data.statement_lines[0]!, book = data.book_lines[0]!;
  assert.match(matchValidation(statement, book, "20.00", data.matches).error, /already have an active match/);
  assert.equal(matchValidation(statement, book, "20.00", data.matches.map(match => ({ ...match, reversed: true }))).amount, "20.00");
});

test("unknown match and reversal outcomes resolve only from relevant saved history", () => {
  const data = read(), action: ReconciliationAction = { kind: "match", statementId, bookId, amount: "20.00", previousIds: [matchId] };
  assert.equal(reconciliationActionObserved(action, data), false);
  const changed = { ...data, matches: [...data.matches, { ...data.matches[0]!, id: receiptId }] };
  assert.equal(reconciliationActionObserved(action, changed), true);
  assert.equal(reconciliationActionObserved({ ...action, amount: "20.01" }, changed), false);
  assert.equal(reconciliationActionObserved(action, { ...changed, matches: changed.matches.map(match => ({ ...match, reversed: true })) }), false);
  assert.equal(reconciliationActionObserved({ kind: "reverse", matchId, reason: "Correct selection" }, data), false);
  assert.equal(reconciliationActionObserved({ kind: "reverse", matchId, reason: "Correct selection" }, { ...data, matches: data.matches.map(match => ({ ...match, reversed: true })) }), true);
});

test("state changes require their actual receipt and preserve earlier evidence after reopen", () => {
  const data = read(), evidence = { finalized_at: "2026-10-09T10:00:00Z", book_closing: "100.01", adjusted_statement_closing: "100.01", unexplained_difference: "0.00" };
  assert.equal(reconciliationActionObserved({ kind: "reopen", reason: "Correct the match" }, data), false);
  const reopened = read({ ...fixture(), reconciliation: { ...fixture().reconciliation, evidence_snapshot: evidence } });
  assert.equal(reconciliationActionObserved({ kind: "reopen", reason: "Correct the match" }, reopened), true);
  assert.deepEqual(reopened.reconciliation.evidence_snapshot, evidence);
  assert.equal(reconciliationActionObserved({ kind: "finalize" }, reopened), false);
  assert.equal(reconciliationActionObserved({ kind: "reopen", reason: "Correct the match" }, { ...reopened, reconciliation: { ...reopened.reconciliation, state: "finalized" } }), false);
  validateReconciliationReceipt({ kind: "match", statementId, bookId, amount: "20.00", previousIds: [] }, { id: receiptId }, reconciliationId);
  validateReconciliationReceipt({ kind: "finalize" }, { id: reconciliationId, state: "finalized", evidence }, reconciliationId);
  assert.throws(() => validateReconciliationReceipt({ kind: "finalize" }, { id: accountId, state: "finalized", evidence }, reconciliationId));
  assert.throws(() => validateReconciliationReceipt({ kind: "reverse", matchId, reason: "Correction" }, { id: receiptId }, reconciliationId));
});
