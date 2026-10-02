import "server-only";

import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";

import { withDatabase, withDatabaseTransaction } from "../database.ts";

export type IdentityTokenPurpose = "verify_email" | "reset_password";

const passwordOptions = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;
let dummyHash: Promise<string> | undefined;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function emailKey(email: string): Buffer {
  return createHash("sha256").update(normalizeEmail(email)).digest();
}

function tokenKey(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export async function createIdentityUser(email: string, password: string, displayName: string): Promise<string | null> {
  const passwordHash = await argon2.hash(password, passwordOptions);
  const result = await withDatabase((client) => client.query<{ id: string }>(
    `INSERT INTO identity.users (email_normalized, display_name, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email_normalized) DO NOTHING
     RETURNING id::text`,
    [normalizeEmail(email), displayName.slice(0, 120), passwordHash]
  ));
  return result.rows[0]?.id ?? null;
}

export async function canAttemptPasswordLogin(email: string): Promise<boolean> {
  const result = await withDatabase((client) => client.query(
    `SELECT 1 FROM identity.auth_rate_limits
     WHERE email_hash = $1 AND blocked_until > now()`,
    [emailKey(email)]
  ));
  return result.rowCount === 0;
}

export async function recordFailedPasswordLogin(email: string): Promise<void> {
  await withDatabaseTransaction(async (client) => {
    const key = emailKey(email);
    await client.query(
      `INSERT INTO identity.auth_rate_limits (email_hash, attempts)
       VALUES ($1, 1) ON CONFLICT (email_hash) DO NOTHING`,
      [key]
    );
    const result = await client.query<{ attempts: number; window_started_at: Date }>(
      `SELECT attempts, window_started_at FROM identity.auth_rate_limits
       WHERE email_hash = $1 FOR UPDATE`,
      [key]
    );
    const current = result.rows[0];
    if (!current) throw new Error("Login limiter row was not created.");
    const expired = Date.now() - new Date(current.window_started_at).getTime() >= 15 * 60 * 1000;
    const attempts = expired ? 1 : Math.min(current.attempts + 1, 1000);
    await client.query(
      `UPDATE identity.auth_rate_limits
       SET window_started_at = CASE WHEN $2 THEN now() ELSE window_started_at END,
           attempts = $3,
           blocked_until = CASE WHEN $3 >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
           updated_at = now()
       WHERE email_hash = $1`,
      [key, expired, attempts]
    );
  });
}

export async function clearPasswordLoginFailures(email: string): Promise<void> {
  await withDatabase((client) => client.query(
    "DELETE FROM identity.auth_rate_limits WHERE email_hash = $1",
    [emailKey(email)]
  ));
}

export async function verifyPasswordHash(hash: string | null, password: string): Promise<boolean> {
  let candidate = hash;
  if (!candidate) {
    dummyHash ??= argon2.hash(randomBytes(32), passwordOptions);
    candidate = await dummyHash;
  }
  try {
    const matches = await argon2.verify(candidate, password);
    return hash !== null && matches;
  } catch {
    return false;
  }
}

export async function issueIdentityToken(userId: string, purpose: IdentityTokenPurpose): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const lifetime = purpose === "verify_email" ? "24 hours" : "1 hour";
  await withDatabaseTransaction(async (client) => {
    await client.query(
      `UPDATE identity.verification_tokens SET consumed_at = now()
       WHERE user_id = $1::uuid AND purpose = $2 AND consumed_at IS NULL`,
      [userId, purpose]
    );
    await client.query(
      `INSERT INTO identity.verification_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1::uuid, $2, $3, now() + $4::interval)`,
      [userId, purpose, tokenKey(token), lifetime]
    );
  });
  return token;
}

export async function findVerifiedIdentityId(email: string): Promise<string | null> {
  const result = await withDatabase((client) => client.query<{ id: string }>(
    `SELECT id::text FROM identity.users
     WHERE email_normalized = $1 AND email_verified_at IS NOT NULL AND disabled_at IS NULL`,
    [normalizeEmail(email)]
  ));
  return result.rows[0]?.id ?? null;
}

export async function reauthenticateIdentity(userId: string, sessionId: string, password: string): Promise<boolean> {
  const user = await withDatabase((client) => client.query<{ password_hash: string }>(
    "SELECT password_hash FROM identity.users WHERE id = $1::uuid AND disabled_at IS NULL AND email_verified_at IS NOT NULL",
    [userId]
  ));
  if (!await verifyPasswordHash(user.rows[0]?.password_hash ?? null, password)) return false;
  return withDatabaseTransaction(async (client) => {
    const result = await client.query(
      `UPDATE identity.auth_sessions s SET recent_auth_at = now()
       FROM identity.users u
       WHERE s.id = $1::uuid AND s.user_id = $2::uuid AND u.id = s.user_id
         AND s.session_version = u.session_version AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL`,
      [sessionId, userId]
    );
    return result.rowCount === 1;
  });
}

export async function findUnverifiedIdentityId(email: string): Promise<string | null> {
  const result = await withDatabase((client) => client.query<{ id: string }>(
    `SELECT id::text FROM identity.users
     WHERE email_normalized = $1 AND email_verified_at IS NULL AND disabled_at IS NULL`,
    [normalizeEmail(email)]
  ));
  return result.rows[0]?.id ?? null;
}

export async function consumeVerificationToken(
  token: string,
  purpose: IdentityTokenPurpose,
  expectedUserId?: string
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  return withDatabaseTransaction(async (client) => {
    const result = await client.query<{ user_id: string }>(
      `SELECT user_id::text FROM identity.verification_tokens
       WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
         AND ($3::uuid IS NULL OR user_id = $3::uuid)
       FOR UPDATE`,
      [tokenKey(token), purpose, expectedUserId ?? null]
    );
    const userId = result.rows[0]?.user_id;
    if (!userId) return null;
    await client.query(
      "UPDATE identity.verification_tokens SET consumed_at = now() WHERE token_hash = $1",
      [tokenKey(token)]
    );
    if (purpose === "verify_email") {
      await client.query(
        "UPDATE identity.users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1::uuid",
        [userId]
      );
    }
    return userId;
  });
}

export async function resetIdentityPassword(token: string, password: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return false;
  const passwordHash = await argon2.hash(password, passwordOptions);
  return withDatabaseTransaction(async (client) => {
    const result = await client.query<{ user_id: string }>(
      `SELECT user_id::text FROM identity.verification_tokens
       WHERE token_hash = $1 AND purpose = 'reset_password'
         AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`,
      [tokenKey(token)]
    );
    const userId = result.rows[0]?.user_id;
    if (!userId) return false;
    await client.query(
      "UPDATE identity.verification_tokens SET consumed_at = now() WHERE token_hash = $1",
      [tokenKey(token)]
    );
    await client.query(
      "UPDATE identity.users SET password_hash = $2, session_version = session_version + 1, updated_at = now() WHERE id = $1::uuid",
      [userId, passwordHash]
    );
    await client.query(
      "UPDATE identity.auth_sessions SET revoked_at = now() WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [userId]
    );
    return true;
  });
}

export async function changeIdentityPassword(userId: string, sessionId: string, password: string): Promise<void> {
  const passwordHash = await argon2.hash(password, passwordOptions);
  await withDatabaseTransaction(async (client) => {
    const result = await client.query(
      `UPDATE identity.users u SET password_hash = $2, session_version = session_version + 1, updated_at = now()
       WHERE u.id = $1::uuid AND u.disabled_at IS NULL
         AND EXISTS (SELECT 1 FROM identity.auth_sessions s
                     WHERE s.id = $3::uuid AND s.user_id = u.id AND s.session_version = u.session_version
                       AND s.revoked_at IS NULL
                       AND s.recent_auth_at > now() - interval '24 hours')`,
      [userId, passwordHash, sessionId]
    );
    if (result.rowCount !== 1) throw new Error("Recent reauthentication is required.");
    await client.query(
      "UPDATE identity.auth_sessions SET revoked_at = now() WHERE user_id = $1::uuid AND revoked_at IS NULL",
      [userId]
    );
  });
}

export async function getProfileName(userId: string): Promise<string | null> {
  const result = await withDatabase((client) => client.query<{ display_name: string }>(
    "SELECT display_name FROM identity.users WHERE id = $1::uuid AND disabled_at IS NULL",
    [userId]
  ));
  return result.rows[0]?.display_name ?? null;
}
