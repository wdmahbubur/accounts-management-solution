import assert from "node:assert/strict";
import test from "node:test";
import { Client, types } from "@neondatabase/serverless";
import "../../apps/web/server/database.ts";
import { normalizeRpcResult, prepareRpcArguments } from "../../apps/web/server/rpc-values.ts";
import { parseApprovalPolicyList } from "../../apps/web/server/approvals/policy-contracts.ts";
import { invitationRows } from "../../apps/web/server/invitations/contracts.ts";
import { parsePeriods } from "../../apps/web/server/periods/contracts.ts";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Exercise the installed driver's bind mapper without connecting to a database.
function driverValues(values) {
  let encoded;
  const query = new Client.Query("SELECT $1", values);
  const connection = {
    parsedStatements: {},
    parse() {},
    bind(config) { encoded = config.values.map(config.valueMapper); },
    describe() {},
    execute() {},
    sync() {}
  };
  assert.equal(query.submit(connection), null);
  assert.ok(encoded);
  return encoded;
}

test("JSON and jsonb row arrays reach the driver as JSON, including empty and nested rows", () => {
  for (const oid of [types.builtins.JSON, types.builtins.JSONB]) {
    for (const rows of [[], [{ row_no: 1, input_data: { name: "গ্রাহক", amount: "9007199254740993.17", tags: ["a", "b"] } }]]) {
      const prepared = prepareRpcArguments({ p_rows: rows }, {
        argument_names: ["p_rows"], argument_type_oids: [oid]
      });
      const [wireValue] = driverValues(prepared.map(([, value]) => value));
      assert.deepEqual(JSON.parse(wireValue), rows);
    }
  }
  assert.throws(() => JSON.parse(driverValues([[{ row_no: 1 }]])[0]));
});

test("actual argument metadata preserves native SQL arrays, buffers and SQL nulls", () => {
  const nativeIds = [ID];
  const nativeText = ["a,b", "বাংলা"];
  const bytes = Buffer.from([0, 255, 1]);
  const prepared = prepareRpcArguments({
    p_json: { amount: "100.00" }, p_bytes: bytes, p_text: nativeText, p_ids: nativeIds, p_optional: null
  }, {
    argument_names: ["p_ids", "p_json", "p_text", "p_bytes", "p_optional"],
    // uuid[] and text[] remain SQL arrays; jsonb[] must also remain a SQL array.
    argument_type_oids: [2951, types.builtins.JSONB, 1009, types.builtins.BYTEA, types.builtins.JSONB]
  });
  assert.strictEqual(prepared[0][1], nativeIds);
  assert.strictEqual(prepared[2][1], nativeText);
  assert.strictEqual(prepared[3][1], bytes);
  const wire = driverValues(prepared.map(([, value]) => value));
  assert.equal(wire[0], `{"${ID}"}`);
  assert.deepEqual(JSON.parse(wire[1]), { amount: "100.00" });
  assert.equal(wire[2], '{"a,b","বাংলা"}');
  assert.deepEqual(wire[3], bytes);
  assert.equal(wire[4], null);
  const jsonSqlArray = [{ value: 1 }];
  assert.strictEqual(prepareRpcArguments({ p_array: jsonSqlArray }, {
    argument_names: ["p_array"], argument_type_oids: [3807]
  })[0][1], jsonSqlArray);
});

test("argument metadata cannot silently serialize another parameter or omit supplied data", () => {
  assert.throws(() => prepareRpcArguments({ p_rows: [] }, {
    argument_names: ["p_other"], argument_type_oids: [types.builtins.JSONB]
  }), /metadata/);
  assert.throws(() => prepareRpcArguments({ p_rows: [] }, {
    argument_names: ["p_rows"], argument_type_oids: []
  }), /metadata/);
  assert.throws(() => prepareRpcArguments({ p_rows: [], p_extra: true }, {
    argument_names: ["p_rows"], argument_type_oids: [types.builtins.JSONB]
  }), /metadata/);
});

test("driver timestamps satisfy existing policy, invitation and locked-period contracts", () => {
  const timestamp = types.getTypeParser(types.builtins.TIMESTAMPTZ)("2026-10-08 19:33:49+00");
  assert.ok(timestamp instanceof Date);
  const policy = {
    id: ID, policy_group_id: ID, version_no: 1, row_version: 1,
    name: "Invoice review", document_type: "invoice", threshold_amount: "0.00",
    approver_role_id: ID, approver_role_name: "Owner", required_approvals: 1,
    allow_self_approval: true, is_active: true, created_at: timestamp
  };
  assert.throws(() => parseApprovalPolicyList([policy]), /Invalid approval policy row/);
  assert.equal(parseApprovalPolicyList(normalizeRpcResult([policy]))[0].createdAt, "2026-10-08T19:33:49.000Z");

  const invitation = {
    invitation_id: ID, email: "invitee@example.test", role_id: ID, role_name: "Accountant",
    invitation_status: "pending", expires_at: timestamp, generation: 1
  };
  assert.throws(() => invitationRows([invitation]), /Invalid invitation row/);
  assert.equal(invitationRows(normalizeRpcResult([invitation]))[0].expiresAt, timestamp.toISOString());

  const period = {
    id: ID, fiscal_year_id: ID, year_label: "2026", label: "October",
    kind: "regular", starts_on: "2026-10-01", ends_on: "2026-10-31", status: "locked",
    locked_at: timestamp, row_version: 2, last_action: "lock", last_reason: "Period closed",
    last_event_at: timestamp
  };
  assert.throws(() => parsePeriods([period]), /Invalid period row/);
  assert.equal(parsePeriods(normalizeRpcResult([period]))[0].lockedAt, timestamp.toISOString());
});

test("result normalization preserves date-only strings, exact money, JSON and private binary bytes", () => {
  const date = types.getTypeParser(types.builtins.DATE)("2026-10-09");
  const bytes = Buffer.from([0, 255, 1]);
  const timestamp = types.getTypeParser(types.builtins.TIMESTAMPTZ)("2026-10-09 01:33:49+06");
  const source = { accounting_date: date, amount: "9007199254740993.17", source_content: bytes,
    metadata: { dates: [timestamp, "2026-10-09"], absent: null }, flag: false };
  const result = normalizeRpcResult(source);
  assert.equal(result.accounting_date, "2026-10-09");
  assert.equal(result.amount, source.amount);
  assert.strictEqual(result.source_content, bytes);
  assert.deepEqual(result.metadata, { dates: ["2026-10-08T19:33:49.000Z", "2026-10-09"], absent: null });
  assert.equal(result.flag, false);
  assert.equal(normalizeRpcResult(timestamp), "2026-10-08T19:33:49.000Z");
  assert.throws(() => normalizeRpcResult(new Date("invalid")), /Invalid time value/);
});
