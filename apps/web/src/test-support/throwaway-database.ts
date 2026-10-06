import { randomUUID } from "node:crypto";
import { Pool } from "pg";

/**
 * A Postgres database of its own for one test, created on the server named by
 * `DATABASE_URL` (test files run in parallel, so they must not share one).
 * Call `drop()` when done.
 */
export async function createThrowawayDatabase(prefix: string) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for a throwaway database");
  const name = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString() });

  return {
    name,
    pool,
    /** Closes the pool, waits for its connections to be gone, then drops the database. */
    async drop() {
      // Pool.end() resolves as soon as its clients are told to close, not once
      // their connections are gone. Dropping the database WITH (FORCE) at that
      // point makes Postgres terminate them (57P01), and the pool has already
      // detached its error listeners, so the errors go unhandled. Wait until
      // Postgres sees no connection to the database, then drop it.
      await pool.end();
      for (let attempt = 0; ; attempt++) {
        const { rows } = await admin.query("SELECT count(*)::int AS open FROM pg_stat_activity WHERE datname = $1", [name]);
        if (rows[0].open === 0) break;
        if (attempt >= 100) throw new Error(`connections to ${name} still open after teardown`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    },
  };
}

export type ThrowawayDatabase = Awaited<ReturnType<typeof createThrowawayDatabase>>;
