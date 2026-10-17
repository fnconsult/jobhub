import type { Pool } from "pg";
import { listenForNotifications } from "../database/listen";
import type { SignInConfiguration } from "./catalog";
import { SIGN_IN_PROVIDERS_CHANNEL } from "./index";

/** How long a read of the database is used before it is read again (a missed NOTIFY). */
export const TTL_MS = 60_000;

export interface WatchedSignInConfiguration {
  /** The configuration in use now, from the cache. Never waits, never throws. */
  current(): SignInConfiguration;
  /** Reads the database now (a read in flight is followed by one more), and returns what is in use then. */
  refresh(): Promise<SignInConfiguration>;
  /** Settles once the database was read a first time (or could not be) and listening started. */
  ready: Promise<void>;
  stop(): Promise<void>;
}

/**
 * The process's sign-in configuration, kept current like the Provider Secrets (ADR-0020):
 * `fallback` (env's Google client) until the database is first read, then the database's,
 * read again on every NOTIFY (a change is in use within seconds) and every TTL_MS at most.
 * A database that cannot be read keeps what was there.
 */
export function watchSignInConfiguration(options: {
  database: Pick<Pool, "connect">;
  load: () => Promise<SignInConfiguration>;
  fallback: SignInConfiguration;
  log?: (line: string) => void;
  ttlMs?: number;
}): WatchedSignInConfiguration {
  const log = options.log ?? ((line: string) => console.warn(line));
  let configuration = options.fallback;
  let reading: Promise<SignInConfiguration> | null = null;
  let queued: Promise<SignInConfiguration> | null = null;

  const read = (): Promise<SignInConfiguration> =>
    options
      .load()
      .then(
        (loaded) => (configuration = loaded),
        (error: unknown) => {
          log(`[sign-in-providers] could not read the database, keeping the sign-in in use: ${error instanceof Error ? error.message : String(error)}`);
          return configuration;
        },
      )
      .finally(() => {
        reading = null;
      });

  // A save made while a read is in flight is read once more afterwards: the read in flight may predate it.
  function refresh(): Promise<SignInConfiguration> {
    if (!reading) return (reading = read());
    queued ??= reading.then(() => {
      queued = null;
      return (reading = read());
    });
    return queued;
  }

  const timer = setInterval(() => void refresh(), options.ttlMs ?? TTL_MS);
  timer.unref();
  let stopListening: (() => Promise<void>) | undefined;
  const ready = (async () => {
    await refresh();
    stopListening = await listenForNotifications(options.database, SIGN_IN_PROVIDERS_CHANNEL, () => void refresh(), { log });
  })();

  return {
    current: () => configuration,
    refresh,
    ready,
    async stop() {
      clearInterval(timer);
      await ready;
      await stopListening?.();
    },
  };
}
