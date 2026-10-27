import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_SEARCH_SETTINGS, webSearchSettingsFromEnv } from "./index";

describe("the web search's settings from the environment (#402, #407)", () => {
  it("defaults to France", () => {
    expect(webSearchSettingsFromEnv({})).toEqual({ country: "FR" });
    expect(DEFAULT_WEB_SEARCH_SETTINGS).toEqual(webSearchSettingsFromEnv({}));
  });

  it("reads the country, as the Back Office or env holds it", () => {
    expect(webSearchSettingsFromEnv({ JOB_DISCOVERY_COUNTRY: "be" })).toEqual({ country: "BE" });
  });

  it("refuses a value it does not take, naming the setting", () => {
    expect(() => webSearchSettingsFromEnv({ JOB_DISCOVERY_COUNTRY: "France" })).toThrow(/JOB_DISCOVERY_COUNTRY/);
  });
});
