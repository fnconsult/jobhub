import type { Pool } from "pg";
import { TTL_MS } from "../database/cached-read";
import { listenForNotifications } from "../database/listen";
import { PLATFORM_SETTINGS_CHANNEL, platformSettingsReader } from "./index";
import { createPlatformSettingsResolver, type PlatformSettingsResolver } from "./resolver";

type Env = Record<string, string | undefined>;

export interface WatchedPlatformSettings {
  /** The Back Office's values, then env's, then the code's defaults (see ./resolver.ts). */
  resolver: PlatformSettingsResolver;
  /** Settles once the database was read a first time (or could not be) and listening started. */
  ready: Promise<void>;
  stop(): Promise<void>;
}

/**
 * The process's Platform Settings, kept current (web app and worker alike): read at start,
 * again on every NOTIFY (a change is in use within seconds), and every TTL_MS at most (a
 * missed NOTIFY, a dropped connection).
 */
export function watchPlatformSettings(options: { database: Pool; env: Env; log?: (line: string) => void }): WatchedPlatformSettings {
  const log = options.log ?? ((line: string) => console.warn(line));
  const resolver = createPlatformSettingsResolver({ load: platformSettingsReader(options.database).load, env: options.env, log });
  const timer = setInterval(() => void resolver.refresh(), TTL_MS);
  timer.unref();
  let stopListening: (() => Promise<void>) | undefined;
  const ready = (async () => {
    await resolver.refresh();
    // Never throws: it keeps trying to listen, the TTL refresh standing in meanwhile.
    stopListening = await listenForNotifications(options.database, PLATFORM_SETTINGS_CHANNEL, () => void resolver.refresh(), { log, label: "platform-settings" });
  })();
  return {
    resolver,
    ready,
    async stop() {
      clearInterval(timer);
      await ready;
      await stopListening?.();
    },
  };
}
