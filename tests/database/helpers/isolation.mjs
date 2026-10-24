import assert from "node:assert/strict";
import { isolatedRecoveryUrl } from "../../../scripts/recovery-database.mjs";

export function assertIsolatedTargets(ownerUrl, runtimeUrl) {
  const host = process.env.AMS_TEST_DATABASE_HOST;
  const owner = isolatedRecoveryUrl(ownerUrl, host);
  const runtime = isolatedRecoveryUrl(runtimeUrl, host);
  assert.equal(owner.pathname, runtime.pathname, "Fixture and runtime must use the same database.");
  assert.notEqual(decodeURIComponent(owner.username), decodeURIComponent(runtime.username), "The application must use a separate restricted login.");
}

export async function assertRestrictedRuntime(pool, runtimeUrl) {
  const row = (await pool.query(`SELECT current_user,session_user,
    NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AS restricted,
    pg_has_role(current_user,'ams_runtime','MEMBER') AS runtime_member,
    EXISTS(SELECT 1 FROM (VALUES ('business_documents'),('journal_entries'),('journal_lines'),('open_items'),('settlement_allocations')) t(name)
      WHERE has_table_privilege(current_user,'finance.'||t.name,'INSERT,UPDATE,DELETE')
      OR has_any_column_privilege(current_user,'finance.'||t.name,'INSERT,UPDATE')) AS financial_dml
    FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.equal(row.current_user, decodeURIComponent(new URL(runtimeUrl).username));
  assert.equal(row.session_user, row.current_user, "Do not impersonate a runtime role from an administrative connection.");
  assert.equal(row.restricted, true);
  assert.equal(row.runtime_member, true);
  assert.equal(row.financial_dml, false, "Financial writes must use the guarded commands.");
}
