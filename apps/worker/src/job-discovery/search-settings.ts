import type { QueryLanguage } from "@jobhub/ai";
import { readNumberSetting, readSetting } from "@jobhub/web/platform-settings";

/**
 * How a Job discovery run searches the web (#386, #402): Platform Settings set on Paramètres' Recherche web tab, over
 * env, over the code's default (ADR-0033). Read at the start of each run, so a change applies to the next one.
 */
export interface WebSearchSettings {
  /** The country whose pages the Search provider favours (ISO 3166-1 alpha-2). */
  country: string;
  /** The oldest a posting may be, in days: asked of the Search provider, and every posting found older is dropped. */
  maxPostingAgeDays: number;
  /** The results each query asks the Search provider for. */
  resultsPerQuery: number;
  /** The job titles per language the queries take: the Search Criteria's own and its variants. */
  titlesPerLanguage: number;
  /** The languages the queries are worded in, in order. */
  queryLanguages: QueryLanguage[];
  /** The Target Companies a run visits (#406). */
  targetCompaniesPerRun: number;
  /** The days before a Target Company is visited again (#406). */
  companyRevisitDays: number;
}

/** JOB_DISCOVERY_QUERY_LANGUAGES' values, as the languages they name. */
const LANGUAGES: Record<string, QueryLanguage[]> = { "fr+en": ["fr", "en"], fr: ["fr"], en: ["en"] };

/** The settings from `env` (env with the Back Office's values over it); an unset or empty one keeps its default, one out of bounds throws, naming it. */
export function webSearchSettingsFromEnv(env: Record<string, string | undefined>): WebSearchSettings {
  return {
    country: String(readSetting(env, "JOB_DISCOVERY_COUNTRY")),
    maxPostingAgeDays: readNumberSetting(env, "JOB_DISCOVERY_MAX_POSTING_AGE_DAYS"),
    resultsPerQuery: readNumberSetting(env, "JOB_DISCOVERY_RESULTS_PER_QUERY"),
    titlesPerLanguage: readNumberSetting(env, "JOB_DISCOVERY_TITLES_PER_LANGUAGE"),
    queryLanguages: [...LANGUAGES[String(readSetting(env, "JOB_DISCOVERY_QUERY_LANGUAGES"))]!],
    targetCompaniesPerRun: readNumberSetting(env, "JOB_DISCOVERY_TARGET_COMPANIES_PER_RUN"),
    companyRevisitDays: readNumberSetting(env, "JOB_DISCOVERY_COMPANY_REVISIT_DAYS"),
  };
}

/** The code's defaults (the Platform Settings catalog's, ADR-0033). */
export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = webSearchSettingsFromEnv({});
