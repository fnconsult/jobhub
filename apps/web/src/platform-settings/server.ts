import { sharedPool } from "@/database/pool";
import { snapshotOfSettings, type PlatformSettingsResolver } from "./resolver";
import { watchPlatformSettings, type WatchedPlatformSettings } from "./watch";

// On globalThis, not in a module variable: Next.js bundles server code into more than
// one chunk, each with its own copy of this module; one cache per process must serve
// them all, or a NOTIFY would refresh only one copy (see database/pool.ts).
const holder = globalThis as { __jobhubPlatformSettings?: WatchedPlatformSettings };

/** Env and the code's defaults alone: nothing read from a database. */
const envOnly: PlatformSettingsResolver = {
  current: () => snapshotOfSettings(process.env, {}),
  refresh: async () => snapshotOfSettings(process.env, {}),
};

/**
 * The Platform Settings in use in this process: the Back Office's, else env's, else the
 * code's defaults. Started before the server serves (instrumentation.ts); without DATABASE_URL
 * (a build, some tests), env and the defaults alone. The mailer reads MAIL_FROM through it (#300).
 */
export function getPlatformSettingsResolver(): PlatformSettingsResolver {
  if (!process.env.DATABASE_URL) return envOnly;
  return watched().resolver;
}

function watched(): WatchedPlatformSettings {
  holder.__jobhubPlatformSettings ??= watchPlatformSettings({ database: sharedPool(), env: process.env });
  return holder.__jobhubPlatformSettings;
}

/**
 * Reads the Platform Settings a first time and starts listening for changes: the server awaits it before
 * serving (instrumentation.ts), so the first AI call is already routed as the Back Office set it (#301), and a
 * DPA marked not signed there is already in force (#302).
 */
export async function startPlatformSettings(): Promise<void> {
  if (process.env.DATABASE_URL) await watched().ready;
}
