import assert from "node:assert/strict";
import test from "node:test";
import { parseIdempotencyKey, parseOrganizationId, parseOptionalRequestId } from "@ams/contracts";
import { reversePostedDocumentCommand } from "../../apps/web/server/documents/reversal.ts";
import { CommandError } from "../../apps/web/server/commands/errors.ts";
import type { OrganizationCommandContext } from "../../apps/web/server/commands/types.ts";

const context = { actor: { organizationId: parseOrganizationId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") },
  idempotencyKey: parseIdempotencyKey("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), requestId: parseOptionalRequestId("reversal-dependency-test"), requestHash: "a".repeat(64) } as OrganizationCommandContext;

test("reversal conflicts explain a child credit's effective date and never expose raw database diagnostics", async () => {
  for (const [message, expected] of [
    ["reverse or resolve posted credit documents before reversing their original source", "REVERSAL_DEPENDENCY"],
    ["reverse dependent linked settlements before their source", "REVERSAL_DEPENDENCY"],
    ["remove draft reconciliation matches before reversing this cash source", "RECONCILIATION_LOCKED"],
    ["private financial diagnostics must stay private", "RECONCILIATION_LOCKED"]
  ]) {
    const command = reversePostedDocumentCommand({ async rpc() { return { data: null, error: { code: "55000", message } }; } }, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    await assert.rejects(() => command.execute(context, { reversalDate: "2025-01-20", reason: "Synthetic dependency correction" }), error => {
      assert.ok(error instanceof CommandError); assert.equal(error.status, 409); assert.equal(error.code, expected);
      assert.doesNotMatch(JSON.stringify(error.fields) + error.message, /private financial diagnostics/);
      assert.match(expected === "REVERSAL_DEPENDENCY" ? error.fields?.reversal_date ?? "" : error.fields?.reconciliation ?? "", expected === "REVERSAL_DEPENDENCY" ? /on or after/ : /active matches/);
      return true;
    });
  }
});
