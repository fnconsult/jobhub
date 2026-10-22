/**
 * Which value of a Platform Setting is in use (CONTEXT.md, ADR-0033): the Back Office's,
 * else env's, else the code's default. Shared by the web app and the worker, built like
 * the Provider Secrets' resolver (one cache, read again on NOTIFY and every TTL_MS).
 *
 *   const resolver = createPlatformSettingsResolver({ load, env: process.env });
 *   await resolver.refresh();                                  // at start-up, on NOTIFY
 *   resolver.current().setting("ANTHROPIC_ENDPOINT");          // its value, source and default
 *   resolver.current().env;                                    // env with the Back Office's values over it
 *
 * The Job Digest, Job discovery (#299) and the AI layer (#301) read their settings through it;
 * the other groups still read env until their editing slice, and Paramètres shows what is in use.
 */
import { cachedRead, type CachedRead } from "../database/cached-read";
import type { SecretResolver, SecretsSnapshot } from "../provider-secrets/resolver";
import { parseSetting, PLATFORM_SETTINGS, platformSetting, type PlatformSetting } from "./catalog";

type Env = Record<string, string | undefined>;

/** The Platform Settings the Back Office set, by name: who set each, and when. */
export type StoredPlatformSettings = Record<string, { value: string; updatedBy: string; updatedAt: Date }>;

/** Where a Platform Setting's value in use comes from. */
export type PlatformSettingSource = "back_office" | "env" | "default";

/** A Platform Setting with its value in use. */
export interface ResolvedPlatformSetting extends PlatformSetting {
  /** The value in use, as env would hold it; empty when nothing sets it and the default is empty. */
  value: string;
  source: PlatformSettingSource;
  /** A value from env that differs from the code's default: how an old `.env` shows up. */
  differsFromDefault: boolean;
  /** Whether the code takes the value in use; false for an env value it would refuse at start-up. */
  valid: boolean;
  /** Who set it in the Back Office, and when; null otherwise. */
  updatedBy: string | null;
  updatedAt: Date | null;
}

export interface PlatformSettingsSnapshot {
  /** Every Platform Setting, in the catalog's order. */
  settings: readonly ResolvedPlatformSetting[];
  setting(name: string): ResolvedPlatformSetting | undefined;
  /** The environment with the Back Office's values over it: what the code's env parsers read. */
  env: Env;
  /** Identifies the values of `names` in use: it changes when one of them does (value or source). */
  versionOf(names: readonly string[]): string;
}

export type PlatformSettingsResolver = CachedRead<PlatformSettingsSnapshot>;

/** Whether two values of `setting` mean the same: compared parsed (0.080 is 0.08), else as written. */
function same(setting: PlatformSetting, a: string, b: string): boolean {
  const left = a ? parseSetting(setting, a) : null;
  const right = b ? parseSetting(setting, b) : null;
  if (left?.ok && right?.ok) return left.value === right.value;
  return a === b;
}

function resolve(setting: PlatformSetting, env: Env, stored: StoredPlatformSettings): ResolvedPlatformSetting {
  const fromBackOffice = stored[setting.name];
  const fromEnv = env[setting.name]?.trim();
  const [value, source]: [string, PlatformSettingSource] = fromBackOffice ? [fromBackOffice.value, "back_office"] : fromEnv ? [fromEnv, "env"] : [setting.default, "default"];
  return {
    ...setting,
    value,
    source,
    differsFromDefault: source === "env" && !same(setting, value, setting.default),
    valid: value === "" || parseSetting(setting, value).ok,
    updatedBy: fromBackOffice?.updatedBy ?? null,
    updatedAt: fromBackOffice?.updatedAt ?? null,
  };
}

/** Every Platform Setting's value in use, from `env` and what the Back Office set. A stored name that is not a Platform Setting is ignored. */
export function snapshotOfSettings(env: Env, stored: StoredPlatformSettings): PlatformSettingsSnapshot {
  const settings = PLATFORM_SETTINGS.map((setting) => resolve(setting, env, stored));
  const byName = new Map(settings.map((setting) => [setting.name, setting]));
  const overlaid: Env = { ...env };
  for (const setting of settings) if (setting.source === "back_office") overlaid[setting.name] = setting.value;
  return {
    settings,
    setting: (name) => byName.get(name),
    env: overlaid,
    versionOf: (names) =>
      names
        .map((name) => {
          const setting = byName.get(name);
          return `${name}=${setting ? `${setting.source}:${setting.value}` : "unknown"}`;
        })
        .join(","),
  };
}

export interface PlatformSettingsResolverOptions {
  /** Reads what the Back Office set (the `platform_setting` table). */
  load: () => Promise<StoredPlatformSettings>;
  env: Env;
  ttlMs?: number;
  now?: () => number;
  /** Where a failed read is said. Default: console.warn. */
  log?: (line: string) => void;
}

/**
 * The Platform Settings in use, from a cache: env and the defaults until the database is
 * read, then the Back Office's values over them. A database that cannot be read keeps what
 * was there.
 */
export function createPlatformSettingsResolver(options: PlatformSettingsResolverOptions): PlatformSettingsResolver {
  return cachedRead({
    load: async () => snapshotOfSettings(options.env, await options.load()),
    initial: snapshotOfSettings(options.env, {}),
    label: "platform-settings",
    ttlMs: options.ttlMs,
    now: options.now,
    log: options.log,
  });
}

/** The Provider Secrets in use with the Back Office's Platform Settings over env's: what a client reading both is built from. */
function secretsOverSettings(secrets: SecretsSnapshot, settings: PlatformSettingsSnapshot): SecretsSnapshot {
  const env: Env = { ...secrets.env };
  for (const setting of settings.settings) if (setting.source === "back_office") env[setting.name] = setting.value;
  return {
    env,
    source: secrets.source,
    versionOf: (names) => names.map((name) => (platformSetting(name) ? settings.versionOf([name]) : secrets.versionOf([name]))).join(","),
  };
}

/**
 * A resolver of the values a client reads among both the Provider Secrets (Clés) and the Platform
 * Settings (Paramètres): its `env` holds each in use, and its `versionOf` changes when either does,
 * so `liveObject` rebuilds the client on a key replaced or a setting changed (#302). `refresh` reads both.
 */
export function secretsOverPlatformSettings(secrets: SecretResolver, settings: PlatformSettingsResolver): SecretResolver {
  return {
    current: () => secretsOverSettings(secrets.current(), settings.current()),
    refresh: async () => {
      const [fromSecrets, fromSettings] = await Promise.all([secrets.refresh(), settings.refresh()]);
      return secretsOverSettings(fromSecrets, fromSettings);
    },
  };
}
