import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("US-005 acceptance matrix tracks every T/S case without treating incomplete work as passes", async () => {
  const matrix = JSON.parse(await readFile("tests/acceptance-matrix.json", "utf8"));
  const ids = matrix.map((entry) => entry.id);
  const expected = [
    ...Array.from({ length: 52 }, (_, index) => `T-${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 20 }, (_, index) => `S-${String(index + 1).padStart(2, "0")}`)
  ];

  assert.deepEqual(ids, expected);
  assert.equal(new Set(ids).size, 72);

  const allowed = new Set(["covered", "partial", "fixture_ready", "pending", "blocked", "failed"]);
  for (const entry of matrix) {
    assert.equal(allowed.has(entry.status), true, `unsupported status for ${entry.id}`);
    if (entry.status !== "pending") {
      assert.equal(entry.evidence.length > 0, true, `${entry.status} ${entry.id} needs evidence`);
      for (const file of entry.evidence) await access(file);
    }
    assert.ok(entry.note?.length > 10, `${entry.id} needs a scope/limitation note`);
    if (entry.status === "covered") assert.equal(entry.last_result, "passed");
    if (entry.status === "blocked" || entry.status === "partial") assert.equal(entry.last_result, entry.status);
  }
});
