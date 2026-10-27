import { readSetting } from "@jobhub/web/platform-settings";

/**
 * How a Job discovery run searches the web (#386, #402): Platform Settings set on Paramètres' Recherche web tab, over
 * env, over the code's default (ADR-0033). Read at the start of each run, so a change applies to the next one.
 */
export interface WebSearchSettings {
  /** The country whose pages the Search provider favours (ISO 3166-1 alpha-2). */
  country: string;
}

/** The settings from `env` (env with the Back Office's values over it); an unset or empty one keeps its default, one it does not take throws, naming it. */
export function webSearchSettingsFromEnv(env: Record<string, string | undefined>): WebSearchSettings {
  return {
    country: String(readSetting(env, "JOB_DISCOVERY_COUNTRY")),
  };
}

/** The code's defaults (the Platform Settings catalog's, ADR-0033). */
export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = webSearchSettingsFromEnv({});
