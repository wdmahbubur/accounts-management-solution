import assert from "node:assert/strict";
import test from "node:test";

import { isEmailVerificationRequired } from "../../apps/web/server/auth/verification-policy.ts";

test("email verification is required by default and for unrecognized values", () => {
  const previous = process.env.AUTH_REQUIRE_EMAIL_VERIFICATION;
  try {
    delete process.env.AUTH_REQUIRE_EMAIL_VERIFICATION;
    assert.equal(isEmailVerificationRequired(), true);
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = "no";
    assert.equal(isEmailVerificationRequired(), true);
  } finally {
    if (previous === undefined) delete process.env.AUTH_REQUIRE_EMAIL_VERIFICATION;
    else process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = previous;
  }
});

test("email verification can be disabled only by an explicit false value", () => {
  const previous = process.env.AUTH_REQUIRE_EMAIL_VERIFICATION;
  try {
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = "false";
    assert.equal(isEmailVerificationRequired(), false);
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = " FALSE ";
    assert.equal(isEmailVerificationRequired(), false);
  } finally {
    if (previous === undefined) delete process.env.AUTH_REQUIRE_EMAIL_VERIFICATION;
    else process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = previous;
  }
});
