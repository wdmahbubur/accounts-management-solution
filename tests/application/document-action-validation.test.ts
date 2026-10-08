import assert from "node:assert/strict";
import test from "node:test";
import { bangladeshDate } from "../../apps/web/lib/date.ts";
import { confirmedDraftReceipt, documentActionError, isConfirmedFormRejection, RecoverableFormRequest, reversalDefaultDate, reversalFieldErrors } from "../../apps/web/app/o/[organizationId]/accounting/documents/document-action-validation.ts";

test("only a positive version and valid matching document identity confirm a draft save", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const receipt = { documentId: id, documentVersion: 2 };
  assert.deepEqual(confirmedDraftReceipt(receipt), receipt);
  assert.deepEqual(confirmedDraftReceipt(receipt, id), receipt);
  for (const documentId of ["", "not-a-document", "/another-page", null]) {
    assert.throws(() => confirmedDraftReceipt({ ...receipt, documentId }), /could not be confirmed/);
  }
  for (const documentVersion of [0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.throws(() => confirmedDraftReceipt({ ...receipt, documentVersion }), /could not be confirmed/);
  }
  assert.throws(() => confirmedDraftReceipt(receipt, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), /could not be confirmed/);
  assert.throws(() => confirmedDraftReceipt(null), /could not be confirmed/);
  const request = new RecoverableFormRequest(() => "same-key");
  request.begin("saved values", 2);
  assert.throws(() => confirmedDraftReceipt({ ...receipt, documentId: "wrong" }));
  request.uncertain();
  assert.equal(request.begin("changed values", 3)?.body, "saved values", "an invalid receipt must not release the pending draft values");
});

test("reversal defaults follow Bangladesh midnight and never precede a future-dated source", () => {
  const companyToday = bangladeshDate(new Date("2026-10-08T18:00:00Z"));
  assert.equal(reversalDefaultDate("2026-10-08", companyToday), "2026-10-09");
  assert.equal(reversalDefaultDate("2026-10-12", companyToday), "2026-10-12");
  assert.equal(reversalDefaultDate("2026-10-09", companyToday), "2026-10-09");
  assert.throws(() => reversalDefaultDate("2026-02-30", companyToday));
  assert.throws(() => reversalDefaultDate("2026-10-08", "not-a-date"));
});

test("reversal validation rejects impossible or earlier dates and whitespace-only reasons", () => {
  const base = { sourceDate: "2026-10-09", date: "2026-10-09", reason: "Duplicate document was recorded." };
  assert.deepEqual(reversalFieldErrors(base), {});
  for (const date of ["", "2026-10-08", "2026-02-30", "2026-10-09T00:00:00Z"]) {
    assert.ok(reversalFieldErrors({ ...base, date }).reversal_date);
  }
  for (const reason of ["          ", "short", "x".repeat(801)]) assert.ok(reversalFieldErrors({ ...base, reason }).reason);
  assert.deepEqual(reversalFieldErrors({ ...base, reason: "  Ten letters  " }), {});
});

test("a lost response retries the original body and key and ignores a second in-flight click", () => {
  let sequence = 0;
  const recovery = new RecoverableFormRequest(() => `key-${++sequence}`);
  const original = JSON.stringify({ reversal_date: "2026-10-09", reason: "Duplicate document" });
  const attempt = recovery.begin(original, 4);
  assert.ok(attempt);
  assert.equal(recovery.begin(original, 4), null);
  recovery.uncertain();
  assert.equal(recovery.needsRetry, true);
  const retry = recovery.begin(JSON.stringify({ reversal_date: "2026-10-10", reason: "Changed later" }), 5);
  assert.deepEqual(retry, { key: "key-1", body: original, revision: 4 });
  assert.equal(recovery.needsRetry, false);
  recovery.confirmed();
  assert.equal(recovery.needsRetry, false);
  assert.equal(recovery.begin("next confirmed operation")?.key, "key-2");
});

test("confirmed validation rejection releases fields while keeping the safe retry key", () => {
  const recovery = new RecoverableFormRequest(() => "same-key");
  recovery.begin("invalid entered values", 1);
  recovery.rejected();
  assert.equal(recovery.needsRetry, false);
  assert.deepEqual(recovery.begin("corrected entered values", 2), { key: "same-key", body: "corrected entered values", revision: 2 });
});

test("only a structured application rejection releases an uncertain operation", () => {
  assert.equal(isConfirmedFormRejection(422, { error: { code: "VALIDATION_FAILED" } }), true);
  assert.equal(isConfirmedFormRejection(409, { error: { code: "STALE_VERSION" } }), true);
  assert.equal(isConfirmedFormRejection(409, { error: { code: "IDEMPOTENCY_CONFLICT" } }), false);
  assert.equal(isConfirmedFormRejection(503, { error: { code: "INTERNAL_ERROR" } }), false);
  assert.equal(isConfirmedFormRejection(408, { error: { code: "VALIDATION_FAILED" } }), false);
  assert.equal(isConfirmedFormRejection(400, "upstream request error"), false);
  assert.equal(isConfirmedFormRejection(400, { error: { code: "UNKNOWN" } }), false);
});

test("field-level application errors survive the client error summary", () => {
  const failure = documentActionError({ error: { code: "VALIDATION_FAILED", message: "Check your draft.", fields: { "lines.2.description": "Describe the second service.", due_date: "Due date is too early.", bad: 4 } } }, "Could not save.");
  assert.equal(failure.message, "Check your draft.");
  assert.deepEqual(failure.fields, { "lines.2.description": "Describe the second service.", due_date: "Due date is too early." });
  assert.deepEqual(documentActionError(null, "Could not save."), { message: "Could not save.", fields: {}, code: "" });
});
