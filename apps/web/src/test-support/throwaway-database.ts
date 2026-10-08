import { randomUUID } from "node:crypto";
import { Pool } from "pg";

/**
 * Every throwaway database this test file created and has not dropped yet,
 * including the ones still being created. A hook that times out on a loaded
 * Postgres keeps running: the database it creates afterwards has no test left
 * to drop it, so `dropLeftoverThrowawayDatabases()` (run after every test file,
 * see vitest.setup.ts) drops it instead of leaving it on the server.
 */
const undropped = new Set<Promise<{ drop(): Promise<void> } | undefined>>();

/**
 * A Postgres database of its own for one test, created on the server named by
 * `DATABASE_URL` (test files run in parallel, so they must not share one).
 * Call `drop()` when done; calling it again does nothing.
 */
export async function createThrowawayDatabase(prefix: string) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for a throwaway database");
  const name = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString });
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString() });

  let dropping: Promise<void> | undefined;
  const database = {
    name,
    pool,
    /** Closes the pool, waits for its connections to be gone, then drops the database. */
    drop(): Promise<void> {
      dropping ??= dropDatabase().finally(() => undropped.delete(registration));
      return dropping;
    },
  };

  async function dropDatabase() {
    // Pool.end() resolves as soon as its clients are told to close, not once
    // their connections are gone. Dropping the database WITH (FORCE) at that
    // point makes Postgres terminate them (57P01), and the pool has already
    // detached its error listeners, so the errors go unhandled. Wait until
    // Postgres sees no connection to the database, then drop it.
    await pool.end();
    try {
      for (let attempt = 0; ; attempt++) {
        const { rows } = await admin.query("SELECT count(*)::int AS open FROM pg_stat_activity WHERE datname = $1", [name]);
        if (rows[0].open === 0) break;
        if (attempt >= 100) throw new Error(`connections to ${name} still open after teardown`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    } finally {
      await admin.end();
    }
  }

  // Registered before CREATE DATABASE is sent, so a file that ends while the
  // database is still being created waits for it and drops it.
  let creationError: unknown;
  const registration = admin.query(`CREATE DATABASE ${name}`).then(
    () => database,
    async (error: unknown) => {
      creationError = error;
      undropped.delete(registration);
      await Promise.all([pool.end(), admin.end()]);
      return undefined;
    },
  );
  undropped.add(registration);
  if (!(await registration)) throw creationError;
  return database;
}

/** Drops every throwaway database created in this test file and not dropped yet. */
export async function dropLeftoverThrowawayDatabases(): Promise<void> {
  const leftovers = await Promise.all(undropped);
  await Promise.all(leftovers.map((database) => database?.drop()));
}

export type ThrowawayDatabase = Awaited<ReturnType<typeof createThrowawayDatabase>>;
