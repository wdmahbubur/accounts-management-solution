import "server-only";

import { Pool, type PoolClient } from "@neondatabase/serverless";

type DatabaseWork<T> = (client: PoolClient) => Promise<T>;
let runtimePool: Pool | undefined;
let workerPool: Pool | undefined;

function openPool(): Pool {
  if (runtimePool) return runtimePool;
  const connectionString = process.env.DATABASE_RUNTIME_URL;
  if (!connectionString) throw new Error("DATABASE_RUNTIME_URL is required for server-side database access.");
  runtimePool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  return runtimePool;
}

function openWorkerPool(): Pool {
  if (workerPool) return workerPool;
  const connectionString = process.env.DATABASE_WORKER_URL;
  if (!connectionString) throw new Error("DATABASE_WORKER_URL is required for background job access.");
  const workerUrl = new URL(connectionString);
  const runtimeUrl = process.env.DATABASE_RUNTIME_URL ? new URL(process.env.DATABASE_RUNTIME_URL) : null;
  if (decodeURIComponent(workerUrl.username) !== "ams_job_worker_login" || !runtimeUrl ||
      workerUrl.hostname !== runtimeUrl.hostname || workerUrl.pathname !== runtimeUrl.pathname) {
    throw new Error("DATABASE_WORKER_URL must use the restricted worker role on the application database.");
  }
  workerPool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  return workerPool;
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
