import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool, neonConfig } from "@neondatabase/serverless";
import "../../scripts/load-local-env.mjs";
import { DEMO_ACCOUNT_EMAIL } from "../../apps/web/server/auth/demo-login.ts";

neonConfig.webSocketConstructor = WebSocket;

function request(payload) {
  return { id: randomUUID(), key: randomUUID(), hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}

async function setActor(client, actorId) {
  await client.query("SELECT set_config('ams.actor_user_id', $1, true)", [actorId ?? ""]);
}

async function expectSqlState(client, code, query, values) {
  await client.query("SAVEPOINT expected_denial");
  try {
    await assert.rejects(client.query(query, values), (error) => error.code === code);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_denial");
    await client.query("RELEASE SAVEPOINT expected_denial");
  }
}

async function createCompanyFixture(client, suffix) {
  const identity = await client.query(
    `INSERT INTO identity.users(email_normalized, display_name, password_hash, email_verified_at)
     VALUES ($1, 'Cash balance regression', '$argon2id$non-login-test-fixture', now()) RETURNING id`,
    [`cash-balance-${randomUUID()}@example.invalid`]
  );
  const actorId = identity.rows[0].id;
  await setActor(client, actorId);
  const created = await client.query(
    `SELECT * FROM public.create_company_atomic($1, $1, 'BD', 'BDT', 'Asia/Dhaka', 1::smallint, '2026-01-01'::date, $2)`,
    [`Cash balance regression ${suffix}`, randomUUID()]
  );
  const organizationId = created.rows[0].organization_id;
  const options = await client.query("SELECT * FROM public.list_cash_account_options($1)", [organizationId]);
  const account = options.rows.find((row) => row.code === "1010");
  assert.ok(account, "Onboarding must supply the bank GL account.");
  const cash = await client.query(
    "SELECT public.save_cash_account($1, $2, 'bank', $3, NULL, NULL, false, true) AS id",
    [organizationId, `QA bank ${suffix}`, account.id]
  );
  return { actorId, organizationId, cashAccountId: cash.rows[0].id, accountId: account.id };
}

async function assertBalance(client, organizationId, cashAccountId, date, expected) {
  const result = await client.query("SELECT * FROM public.read_cash_accounts($1)", [organizationId]);
  const row = result.rows.find((item) => item.id === cashAccountId);
  assert.ok(row, "The selected company's cash account must be present.");
  assert.equal(row.book_balance, expected);
  assert.match(row.book_balance, /^-?\d+\.\d{2}$/);
  const book = await client.query("SELECT public.read_cash_account_ledger($1, $2, $3::date, $3::date) AS value", [
    organizationId, cashAccountId, date
  ]);
  assert.equal(book.rows[0].value.closing_balance, expected);
}

async function saveJournal(client, organizationId, date, debitAccountId, creditAccountId, amount) {
  const payload = {
    document_type: "manual_journal", issue_date: date, accounting_date: date, currency: "BDT",
    description: "Rollback-only cash balance regression", lines: [], allocation_plan: [],
    journal_rows: [
      { account_id: debitAccountId, debit: amount, credit: "0.00", description: "Regression debit" },
      { account_id: creditAccountId, debit: "0.00", credit: amount, description: "Regression credit" }
    ]
  };
  const metadata = request(payload);
  const saved = await client.query("SELECT * FROM public.save_financial_document($1, NULL, NULL, $2, $3, $4, $5::jsonb)", [
    organizationId, metadata.id, metadata.key, metadata.hash, JSON.stringify(payload)
  ]);
  assert.equal(saved.rows[0].state, "draft");
  return saved.rows[0];
}

async function postJournal(client, organizationId, draft) {
  const submission = request(draft.document_id);
  const submitted = await client.query("SELECT * FROM public.submit_financial_document($1, $2, $3, $4, $5, $6, $7)", [
    organizationId, draft.document_id, draft.document_version, `documents.submit:${draft.document_id}`,
    submission.id, submission.key, submission.hash
  ]);
  assert.equal(submitted.rows[0].state, "approved", "The isolated high-threshold fixture policy should auto-approve this source.");
  const posting = request(draft.document_id);
  const posted = await client.query("SELECT * FROM public.post_financial_document($1, $2, $3, $4, $5, $6)", [
    organizationId, draft.document_id, draft.document_version, posting.id, posting.key, posting.hash
  ]);
  assert.equal(posted.rows[0].state, "posted");
}

test("cash-account money contract and tenant boundaries through a real restricted database login", { timeout: 180_000 }, async (t) => {
  assert.equal(process.env.AMS_DATABASE_TESTS, "isolated", "Set AMS_DATABASE_TESTS=isolated only for the disposable test database.");
  assert.ok(process.env.DATABASE_RUNTIME_URL, "DATABASE_RUNTIME_URL must use the isolated restricted application login.");
  const pool = new Pool({ connectionString: process.env.DATABASE_RUNTIME_URL, max: 1, connectionTimeoutMillis: 30_000 });
  let client;
  let stage = "connect";
  try {
    client = await pool.connect();
    stage = "restricted role verification";
    const role = await client.query(`SELECT session_user = current_user AS direct_login,
      NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AS restricted,
      pg_has_role(current_user, 'ams_runtime', 'MEMBER') AS runtime_member,
      has_table_privilege(current_user, 'finance.journal_lines', 'INSERT') AS direct_ledger_insert
      FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`);
    assert.ok(role.rows[0].direct_login && role.rows[0].restricted && role.rows[0].runtime_member && !role.rows[0].direct_ledger_insert,
      "Use the actual restricted application login, with no role escalation or direct ledger write grant.");
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query("SET LOCAL lock_timeout = '5s'");

    stage = "onboarding fixture creation";
    const first = await createCompanyFixture(client, "A");
    const second = await createCompanyFixture(client, "B");
    await setActor(client, first.actorId);
    await t.test("new cash account returns canonical zero matching its empty cashbook", async () => {
      await assertBalance(client, first.organizationId, first.cashAccountId, "2026-01-01", "0.00");
      const result = await client.query("SELECT id FROM public.read_cash_accounts($1)", [first.organizationId]);
      assert.deepEqual(result.rows.map((row) => row.id), [first.cashAccountId]);
    });

    stage = "authorization checks";
    await t.test("anonymous and cross-company reads remain denied", async () => {
      await setActor(client, null);
      await expectSqlState(client, "28000", "SELECT * FROM public.read_cash_accounts($1)", [first.organizationId]);
      await setActor(client, first.actorId);
      await expectSqlState(client, "42501", "SELECT * FROM public.read_cash_accounts($1)", [second.organizationId]);
      await expectSqlState(client, "P0002", "SELECT public.read_cash_account_ledger($1, $2, '2026-01-01', '2026-01-01')", [
        first.organizationId, second.cashAccountId
      ]);
      await setActor(client, second.actorId);
      await expectSqlState(client, "42501", "SELECT * FROM public.read_cash_accounts($1)", [first.organizationId]);
      await assertBalance(client, second.organizationId, second.cashAccountId, "2026-01-01", "0.00");
    });

    // The active synthetic demo permits real posting through public commands.
    // These extra sources, accounts, policy and session never leave this transaction.
    stage = "active synthetic demo fixture";
    const demo = await client.query("SELECT id, session_version FROM identity.users WHERE email_normalized = $1 AND disabled_at IS NULL AND email_verified_at IS NOT NULL", [DEMO_ACCOUNT_EMAIL]);
    assert.equal(demo.rowCount, 1, "Provision the isolated verified public demo before running this regression.");
    await setActor(client, demo.rows[0].id);
    const membership = await client.query(`SELECT o.id FROM finance.organizations o
      JOIN finance.organization_members m ON m.organization_id = o.id
      JOIN finance.member_roles mr ON mr.organization_id = m.organization_id AND mr.member_id = m.id
      JOIN finance.roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id
      WHERE o.name = 'AMS Public Demo' AND o.status = 'active' AND m.user_id = $1 AND m.status = 'active' AND r.template_key = 'owner'`, [demo.rows[0].id]);
    assert.equal(membership.rowCount, 1, "The isolated demo must own exactly its active synthetic company.");
    const organizationId = membership.rows[0].id;
    const policyRows = await client.query("SELECT * FROM public.list_approval_policies($1)", [organizationId]);
    assert.ok(!policyRows.rows.some((row) => row.document_type === "manual_journal" && row.is_active),
      "Use a fresh isolated demo without a manual-journal approval policy for this fixture.");
    await client.query(`INSERT INTO identity.auth_sessions(id, user_id, session_version, recent_auth_at, expires_at)
      VALUES ($1, $2, $3, now(), now() + interval '1 hour')`, [randomUUID(), demo.rows[0].id, demo.rows[0].session_version]);
    const period = await client.query(`SELECT p.starts_on::text AS date FROM finance.accounting_periods p
      JOIN finance.fiscal_years fy ON fy.organization_id = p.organization_id AND fy.id = p.fiscal_year_id
      WHERE p.organization_id = $1 AND p.kind = 'regular' AND p.status = 'open' AND fy.status = 'open'
      ORDER BY p.starts_on LIMIT 1`, [organizationId]);
    assert.equal(period.rowCount, 1, "The synthetic company must have an open regular period.");
    const date = period.rows[0].date;
    const accounts = [];
    for (const [type, side, group] of [["asset", "debit", "cash"], ["equity", "credit", "equity"]]) {
      const saved = await client.query("SELECT * FROM public.save_account($1, $2, NULL, NULL, $3, $4, NULL, $5, $6, $7, NULL, true, true)", [
        organizationId, randomUUID(), `QA${randomUUID().replaceAll("-", "").slice(0,20)}`, "Rollback cash balance fixture", type, side, group
      ]);
      accounts.push(saved.rows[0].account_id);
    }
    const [cashGl, counterpartGl] = accounts;
    const bank = await client.query("SELECT public.save_cash_account($1, $2, 'bank', $3, NULL, NULL, false, true) AS id", [
      organizationId, `QA balance ${randomUUID()}`, cashGl
    ]);
    const cashAccountId = bank.rows[0].id;
    const ownerRole = await client.query("SELECT id FROM finance.roles WHERE organization_id = $1 AND template_key = 'owner'", [organizationId]);
    const policy = request("cash balance regression policy");
    await client.query(`SELECT * FROM public.save_approval_policy($1, $2, $3, $4, NULL, 0, 'Rollback cash balance fixture',
      'manual_journal', '999999999999999999.99', $5, 1, false, true, 'Isolated regression fixture; entire transaction rolls back')`, [
      organizationId, policy.id, policy.key, policy.hash, ownerRole.rows[0].id
    ]);

    stage = "unposted source exclusion";
    const large = await saveJournal(client, organizationId, date, cashGl, counterpartGl, "9007199254740991.99");
    await t.test("an unposted journal source does not affect the cash-account balance", async () => {
      await assertBalance(client, organizationId, cashAccountId, date, "0.00");
    });

    stage = "exact posted balances";
    await t.test("posted debits and credits preserve cents beyond JavaScript's safe integer range", async () => {
      await postJournal(client, organizationId, large);
      await assertBalance(client, organizationId, cashAccountId, date, "9007199254740991.99");
      const smallCredit = await saveJournal(client, organizationId, date, counterpartGl, cashGl, "0.01");
      await postJournal(client, organizationId, smallCredit);
      await assertBalance(client, organizationId, cashAccountId, date, "9007199254740991.98");
    });
    await t.test("negative and settled bank balances remain canonical exact money", async () => {
      const credit = await saveJournal(client, organizationId, date, counterpartGl, cashGl, "9007199254740992.00");
      await postJournal(client, organizationId, credit);
      await assertBalance(client, organizationId, cashAccountId, date, "-0.02");
      const settled = await saveJournal(client, organizationId, date, cashGl, counterpartGl, "0.02");
      await postJournal(client, organizationId, settled);
      await assertBalance(client, organizationId, cashAccountId, date, "0.00");
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
  } catch (error) {
    if (error.code === "ERR_ASSERTION") throw error;
    const sqlState = typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : "unavailable";
    throw new Error(`Cash-account regression failed during ${stage}; SQLSTATE ${sqlState}. Connection details are not printed.`);
  } finally {
    try {
      if (client) await client.query("ROLLBACK");
    } finally {
      client?.release();
      await pool.end();
    }
  }
});
