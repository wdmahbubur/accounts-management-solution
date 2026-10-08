import { Pool } from "@neondatabase/serverless";
import argon2 from "argon2";

import "./load-local-env.mjs";
import { resolveOwnerDatabaseUrl } from "./environment-config.mjs";
import { DEMO_ACCOUNT_EMAIL, DEMO_ACCOUNT_PASSWORD } from "../apps/web/server/auth/demo-login.ts";

const databaseUrl = resolveOwnerDatabaseUrl(process.env);

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
const client = await pool.connect();
const passwordOptions = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 };

try {
  const existing = await client.query(
    "SELECT id::text FROM identity.users WHERE email_normalized = $1",
    [DEMO_ACCOUNT_EMAIL]
  );
  if (existing.rows[0]) {
    const memberships = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE o.name = 'AMS Public Demo')::int AS demo
       FROM finance.organization_members m
       JOIN finance.organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1::uuid AND m.status = 'active'`,
      [existing.rows[0].id]
    );
    const row = memberships.rows[0];
    if (row.total !== row.demo) {
      throw new Error("The public demo account already has another active company; refusing to change it.");
    }
  }

  const passwordHash = await argon2.hash(DEMO_ACCOUNT_PASSWORD, passwordOptions);
  await client.query("BEGIN");
  const user = await client.query(
    `INSERT INTO identity.users (email_normalized, display_name, password_hash, email_verified_at)
     VALUES ($1, 'AMS Demo User', $2, now())
     ON CONFLICT (email_normalized) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           password_hash = EXCLUDED.password_hash,
           email_verified_at = COALESCE(identity.users.email_verified_at, now()),
           disabled_at = NULL,
           updated_at = now()
     RETURNING id::text`,
    [DEMO_ACCOUNT_EMAIL, passwordHash]
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Could not create the demo identity.");

  await client.query(
    `INSERT INTO finance.profiles (user_id, display_name, locale, timezone)
     VALUES ($1::uuid, 'AMS Demo User', 'en-BD', 'Asia/Dhaka')
     ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [userId]
  );
  await client.query("SELECT set_config('ams.actor_user_id', $1, true)", [userId]);

  const company = await client.query(
    `SELECT organization_id::text
     FROM public.create_company_atomic($1::text, $2::text, 'BD'::text, 'BDT'::text,
       'Asia/Dhaka'::text, 1::smallint, $3::date, $4::text)`,
    [
      "AMS Public Demo",
      "AMS Public Demo Company",
      "2026-01-01",
      "ams_public_demo_company_v1"
    ]
  );
  const organizationId = company.rows[0]?.organization_id;
  if (!organizationId) throw new Error("Could not create the demo company.");

  await client.query(
    "UPDATE finance.organizations SET status = 'active', updated_at = now() WHERE id = $1::uuid",
    [organizationId]
  );

  const result = await client.query(
    `SELECT count(DISTINCT m.organization_id)::int AS memberships,
            count(DISTINCT m.organization_id) FILTER (WHERE r.template_key = 'owner')::int AS owner_memberships,
            min(o.name) AS demo_company
     FROM finance.organization_members m
     JOIN finance.organizations o ON o.id = m.organization_id
     LEFT JOIN finance.member_roles mr ON mr.organization_id = m.organization_id AND mr.member_id = m.id
     LEFT JOIN finance.roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id
     WHERE m.user_id = $1::uuid AND m.status = 'active'`,
    [userId]
  );
  if (result.rows[0]?.memberships !== 1 || result.rows[0]?.owner_memberships !== 1 ||
      result.rows[0]?.demo_company !== "AMS Public Demo") {
    throw new Error("Demo access must be Owner of exactly the isolated AMS Public Demo company.");
  }

  await client.query("COMMIT");
  process.stdout.write("Provisioned public demo account as Owner of its isolated AMS Public Demo company.\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
