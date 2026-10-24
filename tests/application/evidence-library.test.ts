import assert from "node:assert/strict";
import test from "node:test";
import { parseEvidence, evidenceSourceDate, evidenceUploadDate } from "../../apps/web/server/artifacts/evidence.ts";

test("draft evidence accepts an absent posted date without inventing one", () => {
  const row = { attachment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", source_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    filename: "evidence.txt", content_type: "text/plain", byte_size: "56", scan_status: "pending", uploaded_at: "2026-10-24T01:30:00Z",
    uploader: "Synthetic owner", source_type: "invoice", source_number: null, source_date: null };
  assert.equal(parseEvidence(row).source_date, null);
  assert.equal(parseEvidence(row).byte_size, 56);
  assert.throws(() => parseEvidence({ ...row, byte_size: "1e3" }));
  assert.match(evidenceSourceDate(null), /after posting/);
  assert.throws(() => parseEvidence({ ...row, source_date: "2025-02-30" }));
  assert.throws(() => parseEvidence({ ...row, scan_status: "unknown" }));
});

test("evidence timestamps follow the company timezone and posted dates remain calendar dates", () => {
  assert.equal(evidenceUploadDate("2026-10-24T01:30:00Z", "America/New_York"), "Oct 23, 2026");
  assert.equal(evidenceUploadDate("2026-10-24T01:30:00Z", "Asia/Dhaka"), "Oct 24, 2026");
  assert.equal(evidenceSourceDate("2024-02-29"), "Feb 29, 2024");
});
