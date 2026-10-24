import assert from "node:assert/strict";
import test from "node:test";
import { parseYearCloseReceipt } from "../../apps/web/server/year-close/contracts.ts";

const run = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", document = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", journal = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
test("zero-nominal receipts require explicit snapshot evidence and no artificial document/journal", () => {
  const data = { run_id: run, close_kind: "zero_nominal", status: "closed", document_id: null, journal_entry_id: null, document_number: null };
  assert.equal(parseYearCloseReceipt(data, "close").kind, "zero_nominal");
  for (const changed of [{ document_id: document }, { journal_entry_id: journal }, { document_number: "YC-1" }, { close_kind: undefined }, { status: "reopened" }]) assert.throws(() => parseYearCloseReceipt({ ...data, ...changed }, "close"));
  assert.equal(parseYearCloseReceipt({ ...data, status: "reopened", reopen_document_id: null }, "reopen").status, "reopened");
});
test("legacy journal receipts remain replayable, while incomplete or wrong-action results stay unconfirmed", () => {
  const data = { run_id: run, status: "closed", document_id: document, journal_entry_id: journal, document_number: "YC-2025-000001" };
  assert.equal(parseYearCloseReceipt(data, "close").kind, "journal");
  assert.throws(() => parseYearCloseReceipt({ ...data, journal_entry_id: null }, "close"));
  assert.throws(() => parseYearCloseReceipt(data, "reopen"));
});
