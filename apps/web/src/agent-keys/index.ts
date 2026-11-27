/**
 * Agent Keys (#1139, ADR-0118): what lets an AI agent reach one scope of the Back Office's API (today only
 * `signalements`, Signalement triage), never a Back Office page, and never as an Administrator.
 *
 * One deep module in front of Postgres. `createAgentKeys(database, { now })` answers:
 *  - `create`: a name (`triage-beta`), a scope and an expiry of AGENT_KEY_MAX_DAYS at most. Its value
 *    (AGENT_KEY_PREFIX + 32 random bytes) is returned once, here, and never again: only its SHA-256 fingerprint is kept;
 *  - `revoke`, `list` and `calls`: what Paramètres › « Clés d'agent » shows and does, a key's last use and the log of its
 *    latest AGENT_KEY_LOG_SIZE calls;
 *  - `authorize`: every call of the API, read afresh from the database: 401 without a key, with an unknown, revoked or
 *    expired one; 429 past AGENT_KEY_RATE_LIMIT. Outside its scope, the key is ignored (#1172): 401 as without one,
 *    revoked or expired alike, and nothing of it counted. Each call of a known key in its scope is logged with its
 *    outcome, and a call let through dates its last use.
 *
 * A key belongs to its environment, not to whoever created it: it names no Administrator and no Candidate. Who created
 * or revoked it is in the Back Office Audit, by its name, never its value. What it changes is signed `key:<name>`
 * (agentSignature).
 */
import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import type { FieldError } from "../validation";
import { AGENT_KEY_LOG_SIZE, AGENT_KEY_MAX_DAYS, AGENT_KEY_NAME, AGENT_KEY_OUTCOMES, AGENT_KEY_PREFIX, AGENT_KEY_RATE_LIMIT, AGENT_KEY_SCOPES, isAgentKeyScope, type AgentKeyOutcome, type AgentKeyScope } from "./values";

export * from "./values";

export interface AgentKey {
  id: string;
  name: string;
  scope: AgentKeyScope;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

export interface AgentKeyCall {
  at: Date;
  method: string;
  /** The path called, with its query string: what the agent asked for, never what it was answered. */
  path: string;
  outcome: AgentKeyOutcome;
}

export type CreateResult = { ok: true; key: AgentKey; /** Shown once, never kept. */ value: string } | { ok: false; errors: FieldError[] } | { ok: false; refused: "name_taken" };

export type Authorization =
  | { ok: true; key: AgentKey }
  /** `out_of_scope`: a key ignored outside its scope, answered as a call without one (#1172). */
  | { ok: false; status: 401; reason: "missing" | "unknown" | "revoked" | "expired" | "out_of_scope" }
  | { ok: false; status: 429; reason: "rate_limited" };

export interface AgentKeys {
  /** `input` is untrusted (a form's values): { name, scope, days }. */
  create(input: unknown, within?: Queryable): Promise<CreateResult>;
  /** Revokes it, dated once; null for no such key. */
  revoke(id: string, within?: Queryable): Promise<{ before: AgentKey; after: AgentKey } | null>;
  /** Every key, newest first, revoked and expired ones included. */
  list(): Promise<AgentKey[]>;
  /** Its latest calls, newest first. */
  calls(id: string): Promise<AgentKeyCall[]>;
  /** Whether `value` (the request's key, null without one) may make this call in `scope`; logs it for a known key of `scope`. */
  authorize(value: string | null, scope: string, call: { method: string; path: string }): Promise<Authorization>;
}

export interface AgentKeysDeps {
  /** Default: the system clock. */
  now?: () => Date;
}

interface Row {
  id: string;
  name: string;
  scope: AgentKeyScope;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
}

const COLUMNS = "id::text, name, scope, created_at, expires_at, revoked_at, last_used_at";

const fromRow = (row: Row): AgentKey => ({
  id: row.id,
  name: row.name,
  scope: row.scope,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  lastUsedAt: row.last_used_at,
});

/** The fingerprint kept of a value: its SHA-256, in hex. */
const fingerprintOf = (value: string): string => createHash("sha256").update(value).digest("hex");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;
/** The longest path a call's log keeps. */
const MAX_LOGGED_PATH = 300;
/** A call the rate limit counts at `$2` (window `$3` seconds): one let through within its window. */
const COUNTED = `outcome = 'allowed' AND at > $2::timestamptz - make_interval(secs => $3)`;

/** The key to create, or what to fix. */
function checked(input: unknown): { name: string; scope: AgentKeyScope; days: number } | FieldError[] {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const errors: FieldError[] = [];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) errors.push({ field: "name", code: "required" });
  else if (!AGENT_KEY_NAME.test(name)) errors.push({ field: "name", code: "invalid" });
  if (!isAgentKeyScope(body.scope)) errors.push({ field: "scope", code: body.scope === undefined ? "required" : "invalid" });
  const days = typeof body.days === "number" ? body.days : typeof body.days === "string" && /^\d{1,3}$/.test(body.days.trim()) ? Number(body.days) : Number.NaN;
  if (!Number.isInteger(days) || days < 1 || days > AGENT_KEY_MAX_DAYS) errors.push({ field: "days", code: "invalid" });
  return errors.length > 0 ? errors : { name, scope: body.scope as AgentKeyScope, days };
}

export function createAgentKeys(database: Pool, deps: AgentKeysDeps = {}): AgentKeys {
  const now = deps.now ?? (() => new Date());

  return {
    async create(input, within = database) {
      const key = checked(input);
      if (Array.isArray(key)) return { ok: false, errors: key };
      const value = `${AGENT_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
      const at = now();
      const { rows } = await within.query<Row>(
        `INSERT INTO agent_key (name, scope, fingerprint, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name) DO NOTHING RETURNING ${COLUMNS}`,
        [key.name, key.scope, fingerprintOf(value), at, new Date(at.getTime() + key.days * DAY_MS)],
      );
      return rows[0] ? { ok: true, key: fromRow(rows[0]), value } : { ok: false, refused: "name_taken" };
    },

    async revoke(id, within = database) {
      if (!UUID.test(id)) return null;
      const { rows } = await within.query<Row>(`SELECT ${COLUMNS} FROM agent_key WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows[0]) return null;
      const before = fromRow(rows[0]);
      if (before.revokedAt) return { before, after: before };
      const { rows: updated } = await within.query<Row>(`UPDATE agent_key SET revoked_at = $2 WHERE id = $1 RETURNING ${COLUMNS}`, [id, now()]);
      return { before, after: fromRow(updated[0]!) };
    },

    async list() {
      const { rows } = await database.query<Row>(`SELECT ${COLUMNS} FROM agent_key ORDER BY created_at DESC, name`);
      return rows.map(fromRow);
    },

    async calls(id) {
      if (!UUID.test(id)) return [];
      const { rows } = await database.query<AgentKeyCall>(
        `SELECT at, method, path, outcome FROM agent_key_call WHERE agent_key_id = $1 ORDER BY id DESC LIMIT ${AGENT_KEY_LOG_SIZE}`,
        [id],
      );
      return rows;
    },

    async authorize(value, scope, call) {
      if (!value) return { ok: false, status: 401, reason: "missing" };
      const at = now();
      return inTransaction(database, async (client) => {
        const { rows } = await client.query<Row>(`SELECT ${COLUMNS} FROM agent_key WHERE fingerprint = $1 FOR UPDATE`, [fingerprintOf(value)]);
        if (!rows[0]) return { ok: false, status: 401, reason: "unknown" } as const;
        const key = fromRow(rows[0]);
        // Outside its scope the key is ignored, whatever its state: not logged, not dated, not counted by the rate limit.
        if (key.scope !== scope) return { ok: false, status: 401, reason: "out_of_scope" } as const;
        const refusal: Exclude<Authorization, { ok: true }> | null = key.revokedAt
          ? { ok: false, status: 401, reason: "revoked" }
          : key.expiresAt.getTime() <= at.getTime()
            ? { ok: false, status: 401, reason: "expired" }
            : (await recentAllowed(client, key.id, at)) >= AGENT_KEY_RATE_LIMIT.calls
              ? { ok: false, status: 429, reason: "rate_limited" }
              : null;
        await client.query(`INSERT INTO agent_key_call (agent_key_id, at, method, path, outcome) VALUES ($1, $2, $3, $4, $5)`, [
          key.id,
          at,
          call.method.slice(0, 10),
          call.path.slice(0, MAX_LOGGED_PATH),
          refusal?.reason ?? "allowed",
        ]);
        // Beyond its latest AGENT_KEY_LOG_SIZE calls, a call is kept only while the rate limit still counts it: otherwise a
        // flood of refused calls would push the allowed ones out of the log and let as many through again.
        await client.query(
          `DELETE FROM agent_key_call WHERE agent_key_id = $1
             AND id NOT IN (SELECT id FROM agent_key_call WHERE agent_key_id = $1 ORDER BY id DESC LIMIT ${AGENT_KEY_LOG_SIZE})
             AND NOT (${COUNTED})`,
          [key.id, at, AGENT_KEY_RATE_LIMIT.seconds],
        );
        if (refusal) return refusal;
        await client.query(`UPDATE agent_key SET last_used_at = $2 WHERE id = $1`, [key.id, at]);
        return { ok: true, key: { ...key, lastUsedAt: at } } as const;
      });
    },
  };
}

/** How many of its calls were let through in the rate limit's window before `at`. */
async function recentAllowed(within: Queryable, keyId: string, at: Date): Promise<number> {
  const { rows } = await within.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM agent_key_call WHERE agent_key_id = $1 AND ${COUNTED}`,
    [keyId, at, AGENT_KEY_RATE_LIMIT.seconds],
  );
  return rows[0]!.n;
}

const listed = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** Creates or upgrades the Agent Key tables. Needs nothing else. Safe to run repeatedly. */
export async function migrateAgentKeys(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS agent_key (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL UNIQUE,
      scope text NOT NULL CHECK (scope IN (${listed(AGENT_KEY_SCOPES)})),
      -- The SHA-256 of its value, in hex: the value itself is never kept.
      fingerprint text NOT NULL UNIQUE CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      last_used_at timestamptz
    );
    -- Its latest ${AGENT_KEY_LOG_SIZE} calls, and the older ones the rate limit still counts: the path asked and the outcome, never what was answered.
    CREATE TABLE IF NOT EXISTS agent_key_call (
      id bigserial PRIMARY KEY,
      agent_key_id uuid NOT NULL REFERENCES agent_key (id) ON DELETE CASCADE,
      at timestamptz NOT NULL,
      method text NOT NULL,
      path text NOT NULL,
      outcome text NOT NULL CHECK (outcome IN (${listed(AGENT_KEY_OUTCOMES)}))
    );
    CREATE INDEX IF NOT EXISTS agent_key_call_key_idx ON agent_key_call (agent_key_id, id DESC);
  `);
}
