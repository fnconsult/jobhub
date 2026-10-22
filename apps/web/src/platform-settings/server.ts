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
 * code's defaults. Started on first use (Paramètres); without DATABASE_URL (a build, some
 * tests), env and the defaults alone. The apps still read env until the editing slices.
 */
export function getPlatformSettingsResolver(): PlatformSettingsResolver {
  if (!process.env.DATABASE_URL) return envOnly;
  holder.__jobhubPlatformSettings ??= watchPlatformSettings({ database: sharedPool(), env: process.env });
  return holder.__jobhubPlatformSettings.resolver;
}
