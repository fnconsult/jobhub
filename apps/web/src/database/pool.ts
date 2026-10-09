import { Pool } from "pg";

type Env = Record<string, string | undefined>;

/** Connections a pool opens at most, unless DATABASE_POOL_MAX says otherwise. */
const DEFAULT_MAX = 10;

// On globalThis, not in a module variable: Next.js bundles server code into more than
// one chunk (pages, route handlers, server actions), each with its own copy of this
// module, and each copy would otherwise open a pool of its own.
const pools: Map<string, Pool> = ((globalThis as { __jobhubPools?: Map<string, Pool> }).__jobhubPools ??= new Map());

/**
 * The process's one Postgres pool for DATABASE_URL, shared by every module of the
 * web app. Postgres refuses clients past max_connections ("sorry, too many clients
 * already"), and every server instance and the worker share that budget: a pool per
 * module multiplied one process's connections by the number of modules.
 */
export function sharedPool(env: Env = process.env): Pool {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing environment variable DATABASE_URL");
  const existing = pools.get(connectionString);
  if (existing && !existing.ending) return existing;
  const pool = new Pool({ connectionString, max: Number(env.DATABASE_POOL_MAX) || DEFAULT_MAX });
  pools.set(connectionString, pool);
  return pool;
}
