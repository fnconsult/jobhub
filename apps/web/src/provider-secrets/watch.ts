import type { Pool } from "pg";
import { secretCipherFromEnv } from "./cipher";
import { listenForNotifications } from "../database/listen";
import { PROVIDER_SECRETS_CHANNEL, providerSecretsReader, type ProviderSecretsReader } from "./index";
import { createSecretResolver, TTL_MS, type SecretResolver } from "./resolver";

type Env = Record<string, string | undefined>;

export interface WatchedProviderSecrets {
  /** Database first, then env (see ./resolver.ts). */
  resolver: SecretResolver;
  reader: ProviderSecretsReader;
  /** Settles once the database was read a first time (or could not be) and listening started. */
  ready: Promise<void>;
  stop(): Promise<void>;
}

/**
 * The process's Provider Secrets, kept current (web app and worker alike): read at
 * start, again on every NOTIFY (a change is in use within seconds), and every TTL_MS
 * at most (a missed NOTIFY, a dropped connection). SECRETS_MASTER_KEYS in `env`
 * opens the rows; without it, env alone is used.
 */
export function watchProviderSecrets(options: { database: Pool; env: Env; log?: (line: string) => void }): WatchedProviderSecrets {
  const log = options.log ?? ((line: string) => console.warn(line));
  const reader = providerSecretsReader(options.database, { cipher: secretCipherFromEnv(options.env), log });
  const resolver = createSecretResolver({ load: reader.load, env: options.env, log });
  const timer = setInterval(() => void resolver.refresh(), TTL_MS);
  timer.unref();
  let stopListening: (() => Promise<void>) | undefined;
  const ready = (async () => {
    await resolver.refresh();
    // Never throws: it keeps trying to listen, the TTL refresh standing in meanwhile.
    stopListening = await listenForNotifications(options.database, PROVIDER_SECRETS_CHANNEL, () => void resolver.refresh(), { log });
  })();
  return {
    resolver,
    reader,
    ready,
    async stop() {
      clearInterval(timer);
      await ready;
      await stopListening?.();
    },
  };
}
