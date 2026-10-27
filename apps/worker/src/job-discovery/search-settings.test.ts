import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_SEARCH_SETTINGS, webSearchSettingsFromEnv } from "./index";

describe("the web search's settings from the environment (#402)", () => {
  it("defaults to France, 30 days, 20 results a query, 3 job titles in French and English, 5 Target Companies revisited after 7 days", () => {
    expect(webSearchSettingsFromEnv({})).toEqual({
      country: "FR",
      maxPostingAgeDays: 30,
      resultsPerQuery: 20,
      titlesPerLanguage: 3,
      queryLanguages: ["fr", "en"],
      targetCompaniesPerRun: 5,
      companyRevisitDays: 7,
    });
    expect(DEFAULT_WEB_SEARCH_SETTINGS).toEqual(webSearchSettingsFromEnv({}));
  });

  it("reads each setting, as the Back Office or env holds it", () => {
    expect(
      webSearchSettingsFromEnv({
        JOB_DISCOVERY_COUNTRY: "be",
        JOB_DISCOVERY_MAX_POSTING_AGE_DAYS: "14",
        JOB_DISCOVERY_RESULTS_PER_QUERY: "8",
        JOB_DISCOVERY_TITLES_PER_LANGUAGE: "1",
        JOB_DISCOVERY_QUERY_LANGUAGES: "en",
        JOB_DISCOVERY_TARGET_COMPANIES_PER_RUN: "0",
        JOB_DISCOVERY_COMPANY_REVISIT_DAYS: "30",
      }),
    ).toEqual({ country: "BE", maxPostingAgeDays: 14, resultsPerQuery: 8, titlesPerLanguage: 1, queryLanguages: ["en"], targetCompaniesPerRun: 0, companyRevisitDays: 30 });
  });

  it("refuses a value out of its bounds, naming the setting", () => {
    expect(() => webSearchSettingsFromEnv({ JOB_DISCOVERY_RESULTS_PER_QUERY: "50" })).toThrow(/JOB_DISCOVERY_RESULTS_PER_QUERY/);
    expect(() => webSearchSettingsFromEnv({ JOB_DISCOVERY_COUNTRY: "France" })).toThrow(/JOB_DISCOVERY_COUNTRY/);
    expect(() => webSearchSettingsFromEnv({ JOB_DISCOVERY_QUERY_LANGUAGES: "de" })).toThrow(/JOB_DISCOVERY_QUERY_LANGUAGES/);
  });
});
