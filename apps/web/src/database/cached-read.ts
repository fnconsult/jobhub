/**
 * What the database holds, read once and served from a cache: the Provider Secrets'
 * resolver and the Platform Settings' share it (web app and worker alike).
 *
 *   const cache = cachedRead({ load, initial, label: "platform-settings" });
 *   cache.current();        // sync, from the cache; a cache TTL_MS old is read again in the background
 *   await cache.refresh();  // at start-up, on NOTIFY: reads now
 *
 * A read that fails keeps what was there (`initial` until a first read succeeds) and is said
 * on `log`, prefixed with `[label]`, with the error's message alone.
 */

/** How long a read of the database is used before it is read again. */
export const TTL_MS = 60_000;

export interface CachedRead<T> {
  /** What was read last, from the cache. Never throws. */
  current(): T;
  /** Reads now (a read already in flight is followed by one more), and returns what is in use then. */
  refresh(): Promise<T>;
}

export interface CachedReadOptions<T> {
  /** Reads the database. */
  load: () => Promise<T>;
  /** What is served until a first read succeeds. */
  initial: T;
  /** Names the cache in what is logged: "provider-secrets". */
  label: string;
  ttlMs?: number;
  now?: () => number;
  /** Where a failed read is said. Default: console.warn. */
  log?: (line: string) => void;
}

export function cachedRead<T>(options: CachedReadOptions<T>): CachedRead<T> {
  const ttlMs = options.ttlMs ?? TTL_MS;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.warn(line));
  let value = options.initial;
  let readAt: number | null = null;
  let reading: Promise<T> | null = null;
  let queued: Promise<T> | null = null;

  function read(): Promise<T> {
    return options
      .load()
      .then(
        (loaded) => {
          value = loaded;
          return value;
        },
        (error: unknown) => {
          // The error is the database's (connection, missing table, a row that does not open), never a value.
          log(`[${options.label}] could not read the database, keeping the values in use: ${error instanceof Error ? error.message : String(error)}`);
          return value;
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
  function refresh(): Promise<T> {
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
      return value;
    },
    refresh,
  };
}
