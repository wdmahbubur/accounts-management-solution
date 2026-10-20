import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "@neondatabase/serverless";
import "../../scripts/load-local-env.mjs";

const metadata = value => ({ id: randomUUID(), key: randomUUID(), hash: createHash("sha256").update(JSON.stringify(value)).digest("hex") });
const units = value => {
  assert.match(value, /^-?\d+(?:\.\d{1,2})?$/);
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * (value.startsWith("-") ? -1n : 1n);
};

test("dated dashboard cash/bank split reconciles under ordinary report roles", { timeout: 180_000 }, async t => {
  assert.equal(process.env.AMS_DATABASE_TESTS, "isolated");
  const url = new URL(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);
  assert.ok(process.env.AMS_TEST_DATABASE_HOST, "Explicitly select the disposable database host.");
  assert.equal(url.hostname, process.env.AMS_TEST_DATABASE_HOST);
  assert.notEqual(url.hostname, "ep-summer-flower-b45z3gnu-pooler.c-6.us-east-2.aws.neon.tech", "Production is forbidden.");
  const runtimeUrl = new URL(process.env.DATABASE_RUNTIME_URL);
  assert.equal(runtimeUrl.hostname, url.hostname);
  assert.equal(runtimeUrl.pathname, url.pathname);
  const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 10_000 });
  const runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 1, connectionTimeoutMillis: 10_000 });
  const setup = await pool.connect();
  let db = setup, runtimeDb, setupReleased = false, currentActor = "";
  const owner = randomUUID(), reader = randomUUID(), billing = randomUUID(), outsider = randomUUID();
  let stage = "isolated fixture setup";
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL statement_timeout='25s'");
    await db.query("SET LOCAL lock_timeout='5s'");
    // Privileged identity/membership seeds create only new synthetic companies.
    // Financial commands and reports use the actual restricted login below.
    for (const id of [owner, reader, billing, outsider]) await db.query(`INSERT INTO identity.users(id,email_normalized,display_name,password_hash,email_verified_at)
      VALUES($1,$2,'Rollback dashboard fixture','$argon2id$non-login-fixture',now())`, [id, `dashboard-${id}@example.invalid`]);
    const actor = async id => {
      currentActor = id;
      if (!runtimeDb) await setup.query("SELECT set_config('ams.actor_user_id',$1,true)", [id]);
    };
    stage = "first company fixture";
    await actor(owner);
    const org = (await db.query("SELECT * FROM public.create_company_atomic('Dashboard split QA','Dashboard split QA','BD','BDT','Asia/Dhaka',1::smallint,'2026-01-01'::date,$1)", [randomUUID()])).rows[0].organization_id;
    await db.query("UPDATE finance.organizations SET status='active',updated_at=now() WHERE id=$1", [org]);
    stage = "second company fixture";
    await actor(outsider);
    const foreignOrg = (await db.query("SELECT * FROM public.create_company_atomic('Dashboard other QA','Dashboard other QA','BD','BDT','Asia/Dhaka',1::smallint,'2026-01-01'::date,$1)", [randomUUID()])).rows[0].organization_id;
    for (const [id, permissions] of [[reader, ["reports.read"]], [billing, ["sales.read"]]]) {
      const member = randomUUID(), role = randomUUID();
      await db.query("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot) VALUES($1,$2,$3,'Dashboard reader')", [member, org, id]);
      await db.query("INSERT INTO finance.roles(id,organization_id,name) VALUES($1,$2,$3)", [role, org, `Dashboard ${id}`]);
      await db.query("INSERT INTO finance.role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM finance.permissions WHERE code=ANY($3::text[])", [org, role, permissions]);
      await db.query("INSERT INTO finance.member_roles(organization_id,member_id,role_id) VALUES($1,$2,$3)", [org, member, role]);
    }
    await db.query(`INSERT INTO identity.auth_sessions(id,user_id,session_version,recent_auth_at,expires_at)
      SELECT $1,id,session_version,now(),now()+interval '1 hour' FROM identity.users WHERE id=$2`, [randomUUID(), owner]);
    const ownerRole = (await db.query("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'", [org])).rows[0].id;
    const counterpart = (await db.query("SELECT id FROM finance.accounts WHERE organization_id=$1 AND account_type='equity' AND is_postable ORDER BY code LIMIT 1", [org])).rows[0].id;
    stage = "ordinary database role";
    await setup.query("COMMIT");
    setup.release(); setupReleased = true;
    runtimeDb = await runtimePool.connect();
    // Each operation gets its own real transaction. Reports intentionally use
    // transaction_timestamp() as cutoff, so a read in the posting transaction
    // would correctly exclude journals posted after that transaction began.
    db = { query: async (sql, args) => {
      await runtimeDb.query("BEGIN");
      try {
        await runtimeDb.query("SET LOCAL statement_timeout='25s'");
        await runtimeDb.query("SELECT set_config('ams.actor_user_id',$1,true)", [currentActor]);
        const result = await runtimeDb.query(sql, args);
        await runtimeDb.query("COMMIT");
        return result;
      } catch (error) { await runtimeDb.query("ROLLBACK"); throw error; }
    } };
    const role = (await db.query(`SELECT current_user=session_user AND pg_has_role(current_user,'ams_runtime','MEMBER') AS ordinary,NOT rolsuper AND NOT rolbypassrls AS restricted,
      has_table_privilege(current_user,'finance.journal_lines','INSERT') AS direct_ledger_write FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.deepEqual(role, { ordinary: true, restricted: true, direct_ledger_write: false });
    await actor(owner);
    stage = "synthetic approval policy";
    const policy = metadata("dashboard fixture policy");
    await db.query(`SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,'Rollback dashboard test','manual_journal',
      '999999999999999999.99',$5,1,false,true,'Synthetic rollback fixture only')`, [org, policy.id, policy.key, policy.hash, ownerRole]);
    stage = "cash account fixtures";
    const accounts = {};
    for (const [key, kind, equivalent] of [["cash", "cash", true], ["bank", "bank", true], ["archived", "bank", true],
      ["mobile_wallet", "mobile_wallet", true], ["payment_clearing", "payment_clearing", true], ["excluded", "bank", false]]) {
      const account = (await db.query("SELECT * FROM public.save_account($1,$2,NULL,NULL,$3,$4,NULL,'asset','debit','cash',NULL,true,true)",
        [org, randomUUID(), `QA${randomUUID().replaceAll("-", "").slice(0, 20)}`, `Dashboard ${key}`])).rows[0].account_id;
      const cash = (await db.query("SELECT public.save_cash_account($1,$2,$3,$4,NULL,NULL,$5,true) AS id", [org, `Dashboard ${key}`, kind, account, equivalent])).rows[0].id;
      accounts[key] = { account, cash };
    }
    async function draft(key, amount, date) {
      const credit = amount.startsWith("-"), value = amount.replace("-", "");
      const body = { document_type: "manual_journal", issue_date: date, accounting_date: date, currency: "BDT", description: "Rollback dashboard balance",
        lines: [], allocation_plan: [], journal_rows: [
          { account_id: accounts[key].account, debit: credit ? "0.00" : value, credit: credit ? value : "0.00", cash_flow_class: "financing", description: "Synthetic cash line" },
          { account_id: counterpart, debit: credit ? value : "0.00", credit: credit ? "0.00" : value, description: "Synthetic equity counterpart" }
        ] };
      const request = metadata(body);
      return (await db.query("SELECT * FROM public.save_financial_document($1,NULL,NULL,$2,$3,$4,$5::jsonb)", [org, request.id, request.key, request.hash, JSON.stringify(body)])).rows[0];
    }
    async function post(key, amount, date) {
      const saved = await draft(key, amount, date), submission = metadata(saved), posting = metadata(saved);
      const submitted = (await db.query("SELECT * FROM public.submit_financial_document($1,$2,$3,$4,$5,$6,$7)",
        [org, saved.document_id, saved.document_version, `documents.submit:${saved.document_id}`, submission.id, submission.key, submission.hash])).rows[0];
      assert.equal(submitted.state, "approved");
      assert.equal((await db.query("SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)",
        [org, saved.document_id, saved.document_version, posting.id, posting.key, posting.hash])).rows[0].state, "posted");
    }
    const snapshot = async (asOf = "2026-01-02", selectedOrg = org) => (await db.query("SELECT public.read_finance_dashboard($1,'2026-01-02'::date,'2026-01-02'::date,$2::date) AS value", [selectedOrg, asOf])).rows[0].value;
    const expectDenied = async (code, work) => {
      await assert.rejects(work, error => error.code === code);
    };
    stage = "empty categories";
    await t.test("empty balances are canonical zero and use the same snapshot cutoff", async () => {
      const value = await snapshot();
      for (const kind of ["cash", "bank", "mobile_wallet", "payment_clearing"]) assert.equal(value.data.liquidity.balances_by_kind[kind].balance, "0.00");
      assert.equal(value.data.liquidity.balances_by_kind.bank.account_count, 2);
      assert.equal(value.filters.as_of, "2026-01-02");
    });
    stage = "dated posted balances";
    for (const [key, amount] of [["cash", "120.25"], ["bank", "6000.01"], ["archived", "100.02"], ["mobile_wallet", "25.03"], ["payment_clearing", "10.04"], ["excluded", "999.99"]]) await post(key, amount, "2026-01-01");
    await db.query("SELECT public.archive_cash_account($1,$2)", [org, accounts.archived.cash]);
    await draft("bank", "777.77", "2026-01-02");
    await post("bank", "10000.00", "2026-01-03");
    await t.test("opening balances, archived banks and other cash equivalents reconcile; drafts and future activity stay excluded", async () => {
      const value = (await snapshot()).data.liquidity;
      assert.equal(value.balances_by_kind.cash.balance, "120.25");
      assert.equal(value.balances_by_kind.bank.balance, "6100.03");
      assert.equal(value.balances_by_kind.mobile_wallet.balance, "25.03");
      assert.equal(value.balances_by_kind.payment_clearing.balance, "10.04");
      assert.equal(Object.values(value.balances_by_kind).reduce((sum, item) => sum + units(item.balance), 0n), units(value.closing_cash_equivalents));
      assert.equal(units(value.closing_cash_equivalents), 625535n);
      assert.equal((await snapshot("2026-01-03")).data.liquidity.balances_by_kind.bank.balance, "16100.03");
    });
    stage = "exact negative and large amounts";
    await t.test("bank overdrafts and large cash cents retain exact decimal values", async () => {
      await post("bank", "-6100.04", "2026-01-02");
      await post("cash", "9007199254740991.99", "2026-01-02");
      const value = (await snapshot()).data.liquidity;
      assert.equal(value.balances_by_kind.bank.balance, "-0.01");
      assert.equal(value.balances_by_kind.cash.balance, "9007199254741112.24");
      assert.equal(Object.values(value.balances_by_kind).reduce((sum, item) => sum + units(item.balance), 0n), units(value.closing_cash_equivalents));
    });
    stage = "report role and tenant boundaries";
    await t.test("reports-only readers receive the split; sales-only, anonymous and other-company callers cannot receive it", async () => {
      await actor(reader);
      await expectDenied("42501", () => db.query("SELECT * FROM public.read_cash_accounts($1)", [org]));
      assert.equal((await snapshot()).data.liquidity.balances_by_kind.bank.balance, "-0.01");
      await actor(billing);
      const limited = (await snapshot()).data;
      assert.equal(limited.liquidity, undefined);
      assert.equal(limited.performance, undefined);
      await actor(outsider);
      await expectDenied("42501", () => snapshot());
      await actor("");
      await expectDenied("42501", () => snapshot());
      await actor(owner);
      await expectDenied("42501", () => snapshot("2026-01-02", foreignOrg));
    });
    // Posted fixture history is retained in this disposable branch, never deleted.
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    throw new Error(`Dashboard split regression failed during ${stage}; SQLSTATE ${/^[0-9A-Z]{5}$/.test(error.code ?? "") ? error.code : "unavailable"}. Credentials are not logged.`);
  } finally {
    if (!setupReleased) { await setup.query("ROLLBACK").catch(() => {}); setup.release(); }
    runtimeDb?.release();
    await Promise.all([pool.end(), runtimePool.end()]);
  }
});
