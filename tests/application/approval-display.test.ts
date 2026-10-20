import assert from "node:assert/strict";
import test from "node:test";
import { approvalCount } from "../../apps/web/lib/approval-display.ts";

test("approval review displays integer policy versions and required/progress counts", () => {
  assert.equal(approvalCount(1, 1), "1");
  assert.equal(approvalCount(12, 1), "12");
  assert.equal(approvalCount(2), "2");
  assert.equal(approvalCount(0), "0");
});

test("missing or malformed approval evidence stays unknown instead of implying zero approvals", () => {
  for (const value of [undefined, null, "2", NaN, Infinity, 1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(approvalCount(value), "—");
  }
  assert.equal(approvalCount(0, 1), "—");
});
