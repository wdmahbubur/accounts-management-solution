import assert from "node:assert/strict";
import test from "node:test";

import { isEmailTransportAvailable, requireInvoiceEmailDelivery } from "../../apps/web/server/email/readiness.ts";
import { CommandError } from "../../apps/web/server/commands/errors.ts";

test("production delivery readiness requires SMTP and the existing restricted worker setup", () => {
  const keys = ["NODE_ENV", "SMTP_URL", "SMTP_FROM", "DATABASE_WORKER_URL", "OUTBOX_WORKER_SECRET"] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.equal(isEmailTransportAvailable(), false);
    process.env.SMTP_URL = "smtp://synthetic.invalid";
    assert.equal(isEmailTransportAvailable(), false);
    process.env.SMTP_FROM = "Test <test@example.invalid>";
    assert.equal(isEmailTransportAvailable(), true);
    assert.throws(requireInvoiceEmailDelivery, error => error instanceof CommandError && error.status === 503 &&
      error.message === "Invoice email delivery is temporarily unavailable. Try again later.");
    process.env.DATABASE_WORKER_URL = "postgres://ams_job_worker_login@synthetic.invalid/db";
    process.env.OUTBOX_WORKER_SECRET = "x".repeat(32);
    assert.doesNotThrow(requireInvoiceEmailDelivery);
    process.env.SMTP_FROM = " ";
    assert.throws(requireInvoiceEmailDelivery, CommandError);
    Object.assign(process.env, { NODE_ENV: "development" });
    assert.equal(isEmailTransportAvailable(), true);
    assert.doesNotThrow(requireInvoiceEmailDelivery);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]; else Reflect.set(process.env, key, previous[index]);
    });
  }
});
