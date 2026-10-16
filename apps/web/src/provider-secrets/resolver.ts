/**
 * Which value of a Provider Secret is in use: the database's, else env's (CONTEXT.md,
 * ADR-0020). Shared by the web app and the worker.
 *
 *   const resolver = createSecretResolver({ load, env: process.env });
 *   await resolver.refresh();                       // at start-up, on NOTIFY, on a 401/403
 *   resolver.current().env.MISTRAL_API_KEY;         // sync: env with the database's values over it
 *   const ai = liveObject(resolver, AI_KEYS, (env) => createAiLayerFromEnv(env)); // rebuilt when one of its keys changes
 *
 * `current()` never waits: it answers from the cache, and reads the database again in
 * the background once the cache is TTL_MS old. A database that cannot be read keeps
 * what was there (env alone until a first read succeeds).
 */

type Env = Record<string, string | undefined>;

/** The Provider Secrets the database holds, decrypted, by name; `row` changes whenever the value does. */
export type StoredSecrets = Record<string, { value: string; row: string }>;

/** Where a Provider Secret's value in use comes from. */
export type SecretSource = "database" | "env" | "missing";

export interface SecretsSnapshot {
  /** The environment with the database's Provider Secrets over it. */
  env: Env;
  source(name: string): SecretSource;
  /** Identifies the values of `names` in use: it changes when one of them does. */
  versionOf(names: readonly string[]): string;
}

export interface SecretResolver {
  /** The values in use now, from the cache. Never throws. */
  current(): SecretsSnapshot;
  /** Reads the database now (a read already in flight is followed by one more), and returns what is in use then. */
  refresh(): Promise<SecretsSnapshot>;
}

/** How long a read of the database is used before it is read again. */
export const TTL_MS = 60_000;

export interface SecretResolverOptions {
  /** Reads the database's Provider Secrets. */
  load: () => Promise<StoredSecrets>;
  env: Env;
  ttlMs?: number;
  now?: () => number;
  /** Where a failed read is said. Default: console.warn. */
  log?: (line: string) => void;
}

/** `env` with the database's Provider Secrets over it: the values in use. */
export function snapshotOf(env: Env, stored: StoredSecrets): SecretsSnapshot {
  const overlaid: Env = { ...env };
  for (const [name, { value }] of Object.entries(stored)) overlaid[name] = value;
  const source = (name: string): SecretSource => (name in stored ? "database" : env[name]?.trim() ? "env" : "missing");
  return {
    env: overlaid,
    source,
    versionOf: (names) => names.map((name) => `${name}=${stored[name]?.row ?? source(name)}`).join(","),
  };
}

export function createSecretResolver(options: SecretResolverOptions): SecretResolver {
  const ttlMs = options.ttlMs ?? TTL_MS;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.warn(line));
  let snapshot = snapshotOf(options.env, {});
  let readAt: number | null = null;
  let reading: Promise<SecretsSnapshot> | null = null;
  let queued: Promise<SecretsSnapshot> | null = null;

  function read(): Promise<SecretsSnapshot> {
    return options
      .load()
      .then(
        (stored) => {
          snapshot = snapshotOf(options.env, stored);
          return snapshot;
        },
        (error: unknown) => {
          // The error is the database's (connection, missing table, a row that does not open), never a value.
          log(`[provider-secrets] could not read the database, keeping the values in use: ${error instanceof Error ? error.message : String(error)}`);
          return snapshot;
        },
      )
      .finally(() => {
        readAt = now();
        reading = null;
      });
  }

  /**
   * Reads now; while a read is in flight, one more read is queued after it (shared by
   * every caller meanwhile): the read in flight may predate the change that asked.
   */
  function refresh(): Promise<SecretsSnapshot> {
    if (!reading) return (reading = read());
    queued ??= reading.then(() => {
      queued = null;
      return (reading = read());
    });
    return queued;
  }

  return {
    current() {
      // A stale cache joins a read in flight: it only needs one newer than the TTL.
      if (!reading && readAt !== null && now() - readAt >= ttlMs) void refresh();
      return snapshot;
    },
    refresh,
  };
}

/** Whether a provider refused the key a call was made with. */
function isRefusedKey(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, statusCode, reason } = error as { status?: unknown; statusCode?: unknown; reason?: unknown };
  return [status, statusCode].some((code) => code === 401 || code === 403) || reason === "unauthorized";
}

/** A getter of what `build` makes from the values in use, built again only when one of `names` changes value (or source). */
export function rebuilding<T>(resolver: SecretResolver, names: readonly string[], build: (env: Env) => T): (snapshot?: SecretsSnapshot) => T {
  let built: { version: string; value: T } | null = null;
  return (snapshot = resolver.current()) => {
    const version = snapshot.versionOf(names);
    if (built?.version !== version) built = { version, value: build(snapshot.env) };
    return built.value;
  };
}

/**
 * A client built by `build` from the values in use, standing in for it: rebuilt when
 * one of `names` changes value (or source), so a key replaced in the Back Office is
 * used without a restart. A method call refused with 401/403 reads the database
 * again and, if one of `names` changed, is made once more on the rebuilt client.
 * `build` may throw (a missing key): the call that needed the client throws then.
 */
export function liveObject<T extends object>(resolver: SecretResolver, names: readonly string[], build: (env: Env) => T): T {
  const clientFor = rebuilding(resolver, names, build);

  return new Proxy({} as T, {
    get(_, property) {
      const snapshot = resolver.current();
      const client = clientFor(snapshot);
      const member = Reflect.get(client, property, client) as unknown;
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        const result = (member as (...a: unknown[]) => unknown).apply(client, args);
        if (!(result instanceof Promise)) return result;
        return result.catch(async (error: unknown) => {
          if (!isRefusedKey(error)) throw error;
          const fresh = await resolver.refresh();
          if (fresh.versionOf(names) === snapshot.versionOf(names)) throw error;
          const rebuilt = clientFor(fresh);
          return (Reflect.get(rebuilt, property, rebuilt) as (...a: unknown[]) => unknown).apply(rebuilt, args);
        });
      };
    },
    has: (_, property) => Reflect.has(clientFor(), property),
  });
}
