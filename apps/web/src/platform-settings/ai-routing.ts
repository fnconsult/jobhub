/**
 * AI routing as Platform Settings (ADR-0033, #301): the AI layer built from env with the Provider
 * Secrets and the Back Office's settings over it, rebuilt when one of them changes, in the web app and
 * the worker alike.
 *
 *   const resolver = withPlatformSettings(secretResolver, platformSettingsResolver);
 *   const ai = liveObject(resolver, [...AI_SECRET_NAMES, ...AI_LAYER_SETTING_NAMES], (env) => createAiLayerFromEnv(env));
 */
import { AI_ROUTING_SETTINGS, checkAiRoutingChange, PRICE_SETTING_NAMES, type AiRoutingCheckDeps } from "@jobhub/ai";
import type { SecretResolver, SecretsSnapshot } from "../provider-secrets/resolver";
import { PLATFORM_SETTINGS } from "./catalog";
import type { PlatformSettingCheck } from "./index";
import type { PlatformSettingsResolver, PlatformSettingsSnapshot } from "./resolver";

type Env = Record<string, string | undefined>;

/** The AI routing Platform Settings' names: a change to one rebuilds the AI layer. */
export const AI_ROUTING_NAMES: readonly string[] = AI_ROUTING_SETTINGS.map((setting) => setting.name);

/** The Platform Settings the AI layer is built from: its routing, and the prices it records each call at (#403). A change to one rebuilds it. */
export const AI_LAYER_SETTING_NAMES: readonly string[] = [...AI_ROUTING_NAMES, ...PRICE_SETTING_NAMES];

const SETTING_NAMES = PLATFORM_SETTINGS.map((setting) => setting.name);

/** `base` with every Platform Setting as `settings` holds it (env's, or the Back Office's over it). */
export function overSettings(base: Env, settings: Env): Env {
  const env: Env = { ...base };
  for (const name of SETTING_NAMES) {
    if (settings[name] === undefined) delete env[name];
    else env[name] = settings[name];
  }
  return env;
}

function combined(secrets: SecretsSnapshot, settings: PlatformSettingsSnapshot): SecretsSnapshot {
  return {
    env: overSettings(secrets.env, settings.env),
    source: secrets.source,
    versionOf: (names) => `${secrets.versionOf(names)}|${settings.versionOf(names.filter((name) => SETTING_NAMES.includes(name)))}`,
  };
}

/**
 * The Provider Secrets' resolver with the Platform Settings over it: env, with the database's keys and the
 * Back Office's settings over it. A client built over it (`liveObject`, `rebuilding`) is rebuilt when one of
 * its keys or settings changes; without a Back Office value, env's is used, as in e2e and local development.
 */
export function withPlatformSettings(secrets: SecretResolver, settings: PlatformSettingsResolver): SecretResolver {
  return {
    current: () => combined(secrets.current(), settings.current()),
    refresh: async () => {
      const [freshSecrets, freshSettings] = await Promise.all([secrets.refresh(), settings.refresh()]);
      return combined(freshSecrets, freshSettings);
    },
  };
}

/**
 * What Paramètres checks an AI routing change with before saving it (ADR-0033): the AI layer built from
 * `secretsEnv()` (env with the Provider Secrets in use) with the settings before and after the change over
 * it, as `checkAiRoutingChange` says. The other Platform Settings are left to their own rules.
 */
export function aiRoutingCheck(secretsEnv: () => Env, deps: AiRoutingCheckDeps = {}): PlatformSettingCheck {
  return async ({ name, before, after }) => {
    if (!AI_ROUTING_NAMES.includes(name)) return null;
    const keys = secretsEnv();
    return checkAiRoutingChange(overSettings(keys, before), overSettings(keys, after), deps);
  };
}
