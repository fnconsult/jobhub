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

import { cachedRead } from "../database/cached-read";

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

export { TTL_MS } from "../database/cached-read";

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
  return cachedRead({
    load: async () => snapshotOf(options.env, await options.load()),
    initial: snapshotOf(options.env, {}),
    label: "provider-secrets",
    ttlMs: options.ttlMs,
    now: options.now,
    log: options.log,
  });
}

/**
 * Whether a provider refused the key a call was made with: HTTP 401/403 (`status`,
 * Stripe's `statusCode`), a contact provider's `unauthorized`, or an SMTP server's
 * authentication failure (535, nodemailer's EAUTH).
 */
function isRefusedKey(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, statusCode, reason, responseCode, code } = error as Record<string, unknown>;
  return [status, statusCode].some((value) => value === 401 || value === 403) || reason === "unauthorized" || responseCode === 535 || code === "EAUTH";
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
 * used without a restart. A method call whose key is refused (401/403, an SMTP 535,
 * or an answer `options.refused` recognises) reads the database again and, if one of
 * `names` changed, is made once more on the rebuilt client.
 * `build` may throw (a missing key): the call that needed the client throws then.
 */
export function liveObject<T extends object>(
  resolver: SecretResolver,
  names: readonly string[],
  build: (env: Env) => T,
  options: {
    /** For a client that answers a refusal rather than throwing it (France Travail's `{ ok: false, reason: "refused" }`). */
    refused?: (answer: unknown) => boolean;
  } = {},
): T {
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
        /** Once more on the client rebuilt from a fresh read, if one of its keys changed; else `otherwise`. */
        const again = async (otherwise: () => unknown) => {
          const fresh = await resolver.refresh();
          if (fresh.versionOf(names) === snapshot.versionOf(names)) return otherwise();
          const rebuilt = clientFor(fresh);
          return (Reflect.get(rebuilt, property, rebuilt) as (...a: unknown[]) => unknown).apply(rebuilt, args);
        };
        return result.then(
          (answer: unknown) => (options.refused?.(answer) ? again(() => answer) : answer),
          (error: unknown) => {
            if (!isRefusedKey(error)) throw error;
            return again(() => {
              throw error;
            });
          },
        );
      };
    },
    has: (_, property) => Reflect.has(clientFor(), property),
  });
}
