import "server-only";

import { Pool, type PoolClient } from "@neondatabase/serverless";

type DatabaseWork<T> = (client: PoolClient) => Promise<T>;

function openPool(): Pool {
  const connectionString = process.env.DATABASE_RUNTIME_URL;
  if (!connectionString) throw new Error("DATABASE_RUNTIME_URL is required for server-side database access.");
  return new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
}

export async function withDatabase<T>(work: DatabaseWork<T>): Promise<T> {
  const pool = openPool();
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
    await pool.end();
  }
}

export async function withActorTransaction<T>(
  verifiedActorId: string,
  work: DatabaseWork<T>
): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(verifiedActorId)) {
    throw new Error("A verified UUID actor is required.");
  }

  return withDatabase(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT set_config('ams.actor_user_id', $1, true)", [verifiedActorId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}
