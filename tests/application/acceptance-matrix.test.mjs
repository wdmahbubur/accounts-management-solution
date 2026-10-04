import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

  const allowed = new Set(["covered", "partial", "fixture_ready", "pending"]);
  for (const entry of matrix) {
    assert.equal(allowed.has(entry.status), true, `unsupported status for ${entry.id}`);
    if (entry.status === "covered" || entry.status === "partial" || entry.status === "fixture_ready") {
      assert.equal(entry.evidence.length > 0, true, `${entry.status} ${entry.id} needs evidence`);
    }
  }

  const covered = matrix.filter((entry) => entry.status === "covered");
  const partial = matrix.filter((entry) => entry.status === "partial");
  const fixtureReady = matrix.filter((entry) => entry.status === "fixture_ready");
  const pending = matrix.filter((entry) => entry.status === "pending");

  assert.deepEqual(covered.map((entry) => entry.id), ["S-05", "S-06"]);
  assert.deepEqual(partial.map((entry) => entry.id), []);
  assert.deepEqual(fixtureReady.map((entry) => entry.id), []);
  assert.equal(covered.length, 2);
  assert.equal(partial.length, 0);
  assert.equal(fixtureReady.length, 0);
  assert.equal(pending.length, 70);
});
