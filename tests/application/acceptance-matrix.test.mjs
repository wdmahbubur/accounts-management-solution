import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("US-005 acceptance matrix tracks every T/S case without treating pending fixtures as passes", async () => {
  const matrix = JSON.parse(await readFile("tests/acceptance-matrix.json", "utf8"));
  const ids = matrix.map((entry) => entry.id);
  const expected = [
    ...Array.from({ length: 52 }, (_, index) => `T-${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 20 }, (_, index) => `S-${String(index + 1).padStart(2, "0")}`)
  ];

  assert.deepEqual(ids, expected);
  assert.equal(new Set(ids).size, 72);

  const allowed = new Set(["covered", "fixture_ready", "pending"]);
  for (const entry of matrix) {
    assert.equal(allowed.has(entry.status), true, `unsupported status for ${entry.id}`);
    if (entry.status === "covered") {
      assert.equal(entry.evidence.length > 0, true, `covered ${entry.id} needs evidence`);
    }
  }

  const covered = matrix.filter((entry) => entry.status === "covered");
  const fixtureReady = matrix.filter((entry) => entry.status === "fixture_ready");
  const pending = matrix.filter((entry) => entry.status === "pending");

  assert.deepEqual(covered.map((entry) => entry.id), ["S-01", "S-02", "S-05", "S-06"]);
  assert.deepEqual(fixtureReady.map((entry) => entry.id), ["T-47"]);
  assert.equal(covered.length, 4);
  assert.equal(fixtureReady.length, 1);
  assert.equal(pending.length, 67);
});
