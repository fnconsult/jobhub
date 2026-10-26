/**
 * Provider Secrets (CONTEXT.md, ADR-0020): third-party keys entered by super-admins
 * in the Back Office, kept encrypted in the database, falling back to env.
 *
 * One deep module. `createProviderSecrets(database, deps)` answers:
 *  - what is each key's state                 `list`: source, fingerprint, who and when; never a value
 *  - change a key                             `replace` (tested first), `clear` (back to env)
 *  - does the key in use work                 `test`
 *  - what each API of a provider answered     `apiAccess`: from its latest test (France Travail's, #400)
 *  - what are the values (web and worker)     `load`, read by the resolver (./resolver.ts)
 *  - move every row to the newest master key  `reencrypt` (the worker's job)
 * and `providerSecretsReader(database, deps)` (`load` and `reencrypt` alone, for the
 * worker), and NOTIFY on PROVIDER_SECRETS_CHANNEL (heard with database/listen.ts, on a pooled
 * connection) and `migrateProviderSecrets(database)`.
 *
 * Every replace and clear is made, recorded in the Back Office Audit (without the
 * value) and announced with NOTIFY in one transaction. A save refused by its failed test, and
 * every test of the key in use, passed or failed, are recorded too (#263), with the tester's
 * scrubbed detail as technical reason. A value goes in, never out:
 * only `load` returns values, and nothing that leaves this module for a page, a log
 * or an audit entry carries one. The table names no Candidate (an Administrator by
 * email only), so it stays out of a Candidate's data export.
 */
import { randomUUID } from "node:crypto";
import { scrubSecrets } from "@jobhub/shared";
import type { Pool } from "pg";
import type { BackOffice, BackOfficeActor, BackOfficeFailure, SecretAction } from "../admin/back-office";
import type { Queryable } from "../database/pool";
import { fingerprintOf, isProviderSecretName, PROVIDER_SECRETS, PROVIDER_SECRET_NAMES, providerOf, type ProviderSecretName, type SecretProvider } from "./catalog";
import type { SealedSecret, SecretCipher } from "./cipher";
import { snapshotOf, type StoredSecrets } from "./resolver";

export { PROVIDER_SECRETS, type ProviderSecretName, type SecretProvider } from "./catalog";

type Env = Record<string, string | undefined>;

/** The Postgres channel a change is announced on. Its payload is empty. */
export const PROVIDER_SECRETS_CHANNEL = "provider_secrets_changed";

/** The longest value accepted. */
const MAX_LENGTH = 4096;

/** A test's detail when the key has no value at all. */
const MISSING = "missing";

/** How a provider with several APIs answered for each (France Travail's, #400): granted, access refused by the provider, or an error. */
export type ApiAccess = "ok" | "refused" | "error";

/**
 * Whether a provider accepts the keys in `env`: its cheapest authenticated call. The detail may be scrubbed further.
 * `apis`: for a provider with several APIs, each one's access, by API.
 */
export type ConnectionTestResult = { ok: true; apis?: Record<string, ApiAccess> } | { ok: false; detail: string; apis?: Record<string, ApiAccess> };
export type ConnectionTester = (provider: SecretProvider, env: Env) => Promise<ConnectionTestResult>;

/** Where a key's value in use comes from: `unreadable` is a database row that does not open (env stands in). */
export type ProviderSecretSource = "database" | "env" | "missing" | "unreadable";

/** One key, as the Back Office shows it. Never its value. */
export interface ProviderSecretStatus {
  name: ProviderSecretName;
  provider: SecretProvider;
  source: ProviderSecretSource;
  /** The last 4 characters of the value in use, for a long enough one. */
  fingerprint: string | null;
  /** The master key version of its database row. */
  keyVersion: number | null;
  /** Who last replaced it in the Back Office, and when; null for env. */
  updatedBy: string | null;
  updatedAt: Date | null;
}

export type ReplaceResult =
  /** Saved; `test` says whether its connection test passed (failed: saved anyway). */
  | { ok: true; test: "passed" | "failed" }
  | { ok: false; error: "unknown_secret" | "empty" | "too_long" | "no_master_key" }
  /** Not saved: the provider refused it; `detail` is scrubbed of the value. */
  | { ok: false; error: "test_failed"; detail: string };

export type ClearResult = { ok: true } | { ok: false; error: "unknown_secret" };

/** One API of a provider, as its latest connection test found it. */
export interface ProviderApiAccess {
  api: string;
  state: ApiAccess;
  testedAt: Date;
}

export interface ProviderSecretsDeps {
  /** Null without SECRETS_MASTER_KEYS: nothing can be saved, env alone is used. */
  cipher: SecretCipher | null;
  backOffice: Pick<BackOffice, "record" | "recordFailure">;
  /** The process environment, the fallback. */
  env: Env;
  testConnection: ConnectionTester;
  /** Where a row that does not open is said. Default: console.warn. */
  log?: (line: string) => void;
}

export interface ProviderSecrets {
  list(): Promise<ProviderSecretStatus[]>;
  /**
   * `actor` replaces key `name` (untrusted) with `value` (untrusted, trimmed). Its provider
   * is tested with it first; a failed test refuses the save unless `saveAnyway`.
   */
  replace(actor: BackOfficeActor, name: unknown, value: unknown, options: { saveAnyway: boolean }): Promise<ReplaceResult>;
  /** `actor` clears key `name` (untrusted) from the database: env's value is used again. */
  clear(actor: BackOfficeActor, name: unknown): Promise<ClearResult>;
  /** `actor` tests the provider of key `name` with the keys in use; recorded, passed or failed. */
  test(actor: BackOfficeActor, name: ProviderSecretName): Promise<ConnectionTestResult>;
  /**
   * Each API of `provider` as the latest test of the keys in use found it (a save, or the Test
   * button), by API; none for a provider with one API, nor once one of its keys is cleared.
   */
  apiAccess(provider: SecretProvider): Promise<ProviderApiAccess[]>;
  /** The values the database holds that open, by name. Rows that do not open are left out (and said, without value). */
  load(): Promise<StoredSecrets>;
  /** Re-encrypts every row not under the newest master key; how many. */
  reencrypt(): Promise<number>;
}

interface SecretRow {
  id: string;
  name: string;
  provider: string;
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  key_version: number;
  updated_by_email: string;
  updated_at: Date;
}

const sealedOf = (row: SecretRow): SealedSecret => ({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyVersion: row.key_version });
const placeOf = (row: Pick<SecretRow, "id" | "name" | "provider">) => ({ provider: row.provider, name: row.name, row: row.id });

/** What the worker needs of Provider Secrets: their values, and moving them to the newest master key. */
export type ProviderSecretsReader = Pick<ProviderSecrets, "load" | "reencrypt">;

/**
 * Reads the Provider Secrets without changing them (the worker, and the store below).
 * `cipher` null (no SECRETS_MASTER_KEYS): no row opens, env alone is used.
 */
export function providerSecretsReader(database: Pool, deps: Pick<ProviderSecretsDeps, "cipher" | "log">): ProviderSecretsReader {
  const { load, reencrypt } = readerWithRows(database, deps);
  return { load, reencrypt };
}

function readerWithRows(database: Pool, deps: Pick<ProviderSecretsDeps, "cipher" | "log">) {
  const log = deps.log ?? ((line: string) => console.warn(line));

  async function rows(within: Queryable = database): Promise<SecretRow[]> {
    const { rows } = await within.query<SecretRow>("SELECT * FROM provider_secret ORDER BY name");
    return rows.filter((row) => isProviderSecretName(row.name));
  }

  function open(row: SecretRow): string | null {
    if (!deps.cipher) return null;
    try {
      return deps.cipher.open(sealedOf(row), placeOf(row));
    } catch (error) {
      log(`[provider-secrets] ${error instanceof Error ? error.message : "a row does not open"}; env is used instead`);
      return null;
    }
  }

  return {
    rows,
    open,

    async load() {
      const stored: StoredSecrets = {};
      for (const row of await rows()) {
        const value = open(row);
        if (value !== null) stored[row.name] = { value, row: row.id };
      }
      return stored;
    },

    async reencrypt() {
      const cipher = deps.cipher;
      if (!cipher) return 0;
      const client = await database.connect();
      let moved = 0;
      try {
        await client.query("BEGIN");
        const { rows: stale } = await client.query<SecretRow>("SELECT * FROM provider_secret WHERE key_version <> $1 ORDER BY name FOR UPDATE", [cipher.activeVersion]);
        for (const row of stale) {
          // A row that does not open is left as it is (and said): re-encrypting cannot repair it.
          const value = open(row);
          if (value === null) continue;
          const sealed = cipher.seal(value, placeOf(row));
          await client.query("UPDATE provider_secret SET ciphertext = $2, iv = $3, tag = $4, key_version = $5 WHERE id = $1", [
            row.id,
            sealed.ciphertext,
            sealed.iv,
            sealed.tag,
            sealed.keyVersion,
          ]);
          moved++;
        }
        await client.query("COMMIT");
        return moved;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export function createProviderSecrets(database: Pool, deps: ProviderSecretsDeps): ProviderSecrets {
  const { rows, open, load, reencrypt } = readerWithRows(database, deps);

  /** The values in use: the database's over env's (as the resolver has them). */
  const envInUse = async (): Promise<Env> => snapshotOf(deps.env, await load()).env;
  /** Every key in use in `env`, to scrub out of what a provider answers. */
  const keysIn = (env: Env) => PROVIDER_SECRET_NAMES.map((secret) => env[secret]);

  async function testWith(provider: SecretProvider, env: Env, secrets: readonly (string | undefined)[]): Promise<ConnectionTestResult> {
    try {
      const result = await deps.testConnection(provider, env);
      return result.ok ? result : { ...result, detail: scrubSecrets(result.detail, secrets).slice(0, 300) };
    } catch (error) {
      return { ok: false, detail: scrubSecrets(error instanceof Error ? error.message : String(error), secrets).slice(0, 300) };
    }
  }

  /** A failed test as the Back Office Audit keeps it: the tester's (scrubbed) detail and the HTTP status it quotes. */
  const failedTest = (name: ProviderSecretName, tried: "replaced" | "tested", detail: string): BackOfficeFailure => {
    const status = /\bHTTP (\d{3})\b/.exec(detail)?.[1];
    return {
      section: "provider_secrets",
      target: name,
      tried,
      reason: detail === MISSING ? "key_missing" : "test_failed",
      ...(tried === "replaced" ? { field: "value" } : {}),
      technical: { class: "ConnectionTest", provider: providerOf(name), ...(status ? { status: Number(status) } : {}), message: detail },
    };
  };

  /** Keeps what each API of `provider` answered in `tested`, in place of what it answered before; nothing for a provider with one API. */
  async function keepApiAccess(within: Queryable, provider: SecretProvider, tested: ConnectionTestResult): Promise<void> {
    if (!tested.apis) return;
    await within.query("DELETE FROM provider_api_access WHERE provider = $1", [provider]);
    const apis = Object.entries(tested.apis);
    await within.query(
      "INSERT INTO provider_api_access (provider, api, state) SELECT $1, unnest($2::text[]), unnest($3::text[])",
      [provider, apis.map(([api]) => api), apis.map(([, state]) => state)],
    );
  }

  /** Runs `write` and records `action` on `name`, then announces the change, all in one transaction. */
  async function recorded(actor: BackOfficeActor, name: ProviderSecretName, write: (within: Queryable) => Promise<boolean>, action: SecretAction): Promise<void> {
    await deps.backOffice.record(
      actor,
      async (within) => {
        const changed = await write(within);
        // Delivered to listeners on commit, not before; never on rollback.
        if (changed) await within.query("SELECT pg_notify($1, '')", [PROVIDER_SECRETS_CHANNEL]);
        return changed;
      },
      (changed) => (changed ? { section: "provider_secrets", target: name, action } : null),
    );
  }

  return {
    load,
    reencrypt,

    async list() {
      const stored = new Map((await rows()).map((row) => [row.name, row]));
      return PROVIDER_SECRETS.map(({ name, provider }): ProviderSecretStatus => {
        const row = stored.get(name);
        const value = row ? open(row) : null;
        if (row && value !== null) {
          return { name, provider, source: "database", fingerprint: fingerprintOf(value), keyVersion: row.key_version, updatedBy: row.updated_by_email, updatedAt: row.updated_at };
        }
        const fromEnv = deps.env[name]?.trim();
        return {
          name,
          provider,
          source: row ? "unreadable" : fromEnv ? "env" : "missing",
          fingerprint: fromEnv ? fingerprintOf(fromEnv) : null,
          keyVersion: row?.key_version ?? null,
          updatedBy: row?.updated_by_email ?? null,
          updatedAt: row?.updated_at ?? null,
        };
      });
    },

    async replace(actor, name, rawValue, { saveAnyway }) {
      if (!isProviderSecretName(name)) return { ok: false, error: "unknown_secret" };
      const value = typeof rawValue === "string" ? rawValue.trim() : "";
      if (!value) return { ok: false, error: "empty" };
      if (value.length > MAX_LENGTH) return { ok: false, error: "too_long" };
      const cipher = deps.cipher;
      if (!cipher) return { ok: false, error: "no_master_key" };

      const provider = providerOf(name);
      const inUse = await envInUse();
      const tested = await testWith(provider, { ...inUse, [name]: value }, [value, ...keysIn(inUse)]);
      if (!tested.ok && !saveAnyway) {
        await deps.backOffice.recordFailure(actor, failedTest(name, "replaced", tested.detail));
        return { ok: false, error: "test_failed", detail: tested.detail };
      }

      const id = randomUUID();
      const sealed = cipher.seal(value, { provider, name, row: id });
      await recorded(
        actor,
        name,
        async (within) => {
          await within.query(
            `INSERT INTO provider_secret (name, id, provider, ciphertext, iv, tag, key_version, updated_by_email, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
             ON CONFLICT (name) DO UPDATE SET id = excluded.id, provider = excluded.provider, ciphertext = excluded.ciphertext, iv = excluded.iv,
               tag = excluded.tag, key_version = excluded.key_version, updated_by_email = excluded.updated_by_email, updated_at = excluded.updated_at`,
            [name, id, provider, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyVersion, actor.email.trim().toLowerCase()],
          );
          await keepApiAccess(within, provider, tested);
          return true;
        },
        tested.ok ? "replaced" : "replaced_despite_failed_test",
      );
      return { ok: true, test: tested.ok ? "passed" : "failed" };
    },

    async clear(actor, name) {
      if (!isProviderSecretName(name)) return { ok: false, error: "unknown_secret" };
      await recorded(
        actor,
        name,
        async (within) => {
          const cleared = ((await within.query("DELETE FROM provider_secret WHERE name = $1", [name])).rowCount ?? 0) > 0;
          // What its APIs answered no longer says anything of the keys now in use.
          if (cleared) await within.query("DELETE FROM provider_api_access WHERE provider = $1", [providerOf(name)]);
          return cleared;
        },
        "cleared",
      );
      return { ok: true };
    },

    async test(actor, name) {
      const env = await envInUse();
      const tested: ConnectionTestResult = env[name]?.trim() ? await testWith(providerOf(name), env, keysIn(env)) : { ok: false, detail: MISSING };
      await keepApiAccess(database, providerOf(name), tested);
      if (tested.ok) await deps.backOffice.record(actor, async () => null, () => ({ section: "provider_secrets", target: name, action: "tested", before: null, after: null }));
      else await deps.backOffice.recordFailure(actor, failedTest(name, "tested", tested.detail));
      return tested;
    },

    async apiAccess(provider) {
      const { rows } = await database.query<ProviderApiAccess>(
        `SELECT api, state, tested_at AS "testedAt" FROM provider_api_access WHERE provider = $1 ORDER BY api`,
        [provider],
      );
      return rows;
    },
  };
}


/** Creates the Provider Secrets table. Safe to run repeatedly. */
export async function migrateProviderSecrets(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS provider_secret (
      -- The env variable the value stands for, e.g. MISTRAL_API_KEY.
      name text PRIMARY KEY,
      -- New on every replace; part of the additional authenticated data, so a value moved onto another row does not open.
      id text NOT NULL UNIQUE,
      provider text NOT NULL,
      -- AES-256-GCM (ADR-0020): the value never sits here in clear.
      ciphertext bytea NOT NULL,
      iv bytea NOT NULL,
      tag bytea NOT NULL,
      -- The SECRETS_MASTER_KEYS version it is sealed under.
      key_version integer NOT NULL,
      -- The Administrator by email only: no Candidate id, so this table is never part of a Candidate's data export.
      updated_by_email text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    -- What each API of a provider with several (France Travail's, #400) answered its latest connection test. No secret, no Candidate.
    CREATE TABLE IF NOT EXISTS provider_api_access (
      provider text NOT NULL,
      api text NOT NULL,
      state text NOT NULL CHECK (state IN ('ok', 'refused', 'error')),
      tested_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (provider, api)
    );
  `);
}
