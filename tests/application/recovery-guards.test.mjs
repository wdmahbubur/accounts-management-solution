import assert from "node:assert/strict";
import test from "node:test";
import { isolatedRecoveryUrl } from "../../scripts/recovery-database.mjs";

test("recovery tooling rejects production, pooled aliases, implicit targets and missing opt-in", () => {
  const saved = process.env.AMS_DATABASE_TESTS;
  const testHost = "isolated-recovery.example.invalid";
  try {
    delete process.env.AMS_DATABASE_TESTS;
    assert.throws(() => isolatedRecoveryUrl(`postgresql://fixture@${testHost}/test`, testHost));
    process.env.AMS_DATABASE_TESTS = "isolated";
    for (const host of ["ep-summer-flower-b45z3gnu-pooler.c-6.us-east-2.aws.neon.tech", "ep-summer-flower-b45z3gnu.c-6.us-east-2.aws.neon.tech"]) {
      assert.throws(() => isolatedRecoveryUrl(`postgresql://fixture@${host}/test`, host));
    }
    assert.throws(() => isolatedRecoveryUrl(`postgresql://fixture@${testHost}/test`, undefined));
    assert.throws(() => isolatedRecoveryUrl(`postgresql://fixture@${testHost}/test`, "other.example.invalid"));
    assert.throws(() => isolatedRecoveryUrl(`postgresql://${testHost}/test`, testHost));
    assert.throws(() => isolatedRecoveryUrl(`postgresql://fixture@${testHost}/`, testHost));
    assert.equal(isolatedRecoveryUrl(`postgresql://fixture@${testHost}/test`, testHost).hostname, testHost);
  } finally {
    if (saved === undefined) delete process.env.AMS_DATABASE_TESTS;
    else process.env.AMS_DATABASE_TESTS = saved;
  }
});
