import "server-only";

import { Pool, types, type PoolClient } from "@neondatabase/serverless";

// PostgreSQL DATE is a calendar value without a time zone. Keep it as its
// canonical YYYY-MM-DD text instead of letting node-pg shift it through the
// host's local time zone before domain validation or JSON serialization.
types.setTypeParser(types.builtins.DATE, (value) => value);

type DatabaseWork<T> = (client: PoolClient) => Promise<T>;
let runtimePool: Pool | undefined;
let workerPool: Pool | undefined;

function openPool(): Pool {
  if (runtimePool) return runtimePool;
  const connectionString = process.env.DATABASE_RUNTIME_URL;
  if (!connectionString) throw new Error("DATABASE_RUNTIME_URL is required for server-side database access.");
  // Allow simultaneous layout/command/auth reads without a single busy
  // connection starving other requests. Keep the per-instance pool bounded;
  // actor identity remains transaction-local on every checked-out connection.
  runtimePool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000 });
  return runtimePool;
}

function openWorkerPool(): Pool {
  if (workerPool) return workerPool;
  const connectionString = process.env.DATABASE_WORKER_URL;
  if (!connectionString) throw new Error("DATABASE_WORKER_URL is required for background job access.");
  const workerUrl = new URL(connectionString);
  // A dedicated worker host needs only a credential-free target reference,
  // rather than a second credential granting interactive application access.
  const target = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_WORKER_TARGET_URL;
  const runtimeUrl = target ? new URL(target) : null;
  if (decodeURIComponent(workerUrl.username) !== "ams_job_worker_login" || !runtimeUrl ||
      workerUrl.hostname !== runtimeUrl.hostname || workerUrl.pathname !== runtimeUrl.pathname) {
    throw new Error("DATABASE_WORKER_URL must use the restricted worker role on the application database.");
  }
  workerPool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  return workerPool;
}

/** Drain only after the job runner has stopped claiming and finished its batch. */
export async function closeWorkerDatabase(): Promise<void> {
  const pool = workerPool;
  workerPool = undefined;
  await pool?.end();
}

export async function withDatabase<T>(work: DatabaseWork<T>): Promise<T> {
  const pool = openPool();
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export async function withWorkerDatabase<T>(work: DatabaseWork<T>): Promise<T> {
  const pool = openWorkerPool();
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export async function withDatabaseTransaction<T>(work: DatabaseWork<T>): Promise<T> {
  return withDatabase(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

export async function withActorTransaction<T>(
  verifiedActorId: string,
  work: DatabaseWork<T>
): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(verifiedActorId)) {
    throw new Error("A verified UUID actor is required.");
  }

  return withDatabaseTransaction(async (client) => {
    await client.query("SELECT set_config('ams.actor_user_id', $1, true)", [verifiedActorId]);
    return work(client);
  });
}
