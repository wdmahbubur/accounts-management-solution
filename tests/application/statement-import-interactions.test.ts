import assert from "node:assert/strict";
import test from "node:test";
import { emptyMapping, importNextHref, mappingFields, readImportReceipt, readInspection, readStatementPreview, restoreMapping, validateMapping } from "../../apps/web/app/o/[organizationId]/banking/import/import-interactions.ts";

const organizationId = "a845a9f5-773d-45ee-aaca-824f2ee43001", accountId = "a845a9f5-773d-45ee-aaca-824f2ee43002", importId = "a845a9f5-773d-45ee-aaca-824f2ee43003";
const sha = "ab".repeat(32);
const preview = () => ({ headers: ["Date", "Description", "Debit", "Credit"], preview: [["2026-10-09", "Deposit", "", "100.01"]], file_sha256: sha, row_count: 1, valid_count: 1, errors: [], repeated_fingerprint_groups: 0, prior_fingerprint_groups: 0, starts_on: "2026-10-09", ends_on: "2026-10-09" });

test("signed and split mappings exclude inactive columns and detect duplicate or missing selections", () => {
  const mapping = { ...emptyMapping(), date: "0", description: "1", debit: "2", credit: "3", amount: "2" };
  assert.deepEqual(validateMapping(mapping, "split", 4), {});
  assert.deepEqual(mappingFields(mapping, "split"), { date: 0, description: 1, debit: 2, credit: 3 });
  assert.deepEqual(mappingFields(mapping, "signed"), { date: 0, description: 1, amount: 2 });
  assert.ok(validateMapping({ ...mapping, credit: "2" }, "split", 4).debit);
  assert.ok(validateMapping({ ...mapping, amount: "" }, "signed", 4).amount);
  assert.ok(validateMapping({ ...mapping, credit: "4" }, "split", 4).credit);
});

test("saved mappings recover only when complete and valid for the selected file", () => {
  const mapping = { ...emptyMapping(), date: "0", description: "1", debit: "2", credit: "3" };
  assert.deepEqual(restoreMapping(JSON.stringify(mapping), 4), { mapping, format: "split" });
  for (const value of [null, "not-json", "[]", JSON.stringify({ ...mapping, debit: 2 }), JSON.stringify({ ...mapping, credit: "8" })]) assert.equal(restoreMapping(value, 4), null);
  assert.equal(restoreMapping(JSON.stringify(mapping), 3), null);
});

test("preview must match the inspected file, row counts and real calendar dates", () => {
  assert.equal(readInspection(preview()).sha256, sha);
  assert.equal(readStatementPreview(preview(), sha).valid_count, 1);
  for (const change of [{ file_sha256: "cd".repeat(32) }, { valid_count: 2 }, { starts_on: "2026-02-30" }, { ends_on: "2026-13-01" }, { headers: [null, {}] }, { starts_on: null }]) assert.throws(() => readStatementPreview({ ...preview(), ...change }, sha));
  const lastRowError = { ...preview(), row_count: 10000, valid_count: 9999, errors: [{ row_no: 10001, message: "Enter an amount." }] };
  assert.equal(readStatementPreview(lastRowError, sha).errors[0]!.row_no, 10001);
});

test("new imports hand off the confirmed account and dates to reconciliation", () => {
  const raw = { id: importId, duplicate: false, row_count: 1, review_count: 0, cash_account_id: accountId, starts_on: "2026-10-09", ends_on: "2026-10-10" };
  const result = readImportReceipt(raw, accountId, 1);
  const url = new URL(importNextHref(organizationId, result), "https://example.test");
  assert.equal(url.pathname, `/o/${organizationId}/banking/reconciliations`);
  assert.equal(url.searchParams.get("cash_account_id"), accountId);
  assert.equal(url.searchParams.get("starts_on"), "2026-10-09");
  assert.equal(url.searchParams.get("ends_on"), "2026-10-10");
  for (const change of [{ id: null }, { cash_account_id: organizationId }, { row_count: 0 }, { starts_on: "2026-10-11" }]) assert.throws(() => readImportReceipt({ ...raw, ...change }, accountId, 1));
});

test("duplicate receipts use real saved-import semantics and cannot invent a date range", () => {
  const raw = { id: importId, duplicate: true, row_count: 0, cash_account_id: accountId, starts_on: null, ends_on: null };
  const result = readImportReceipt(raw, accountId, 12);
  assert.equal(result.duplicate, true);
  assert.equal(result.row_count, 0);
  const url = new URL(importNextHref(organizationId, result), "https://example.test");
  assert.equal(url.searchParams.get("cash_account_id"), accountId);
  assert.equal(url.searchParams.has("starts_on"), false);
  assert.throws(() => readImportReceipt({ ...raw, row_count: 12 }, accountId, 12));
  assert.throws(() => readImportReceipt({ ...raw, starts_on: "2026-10-09", ends_on: "2026-10-09" }, accountId, 12));
});
