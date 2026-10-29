import { describe, expect, it } from "vitest";
import { comparesScreenshots } from "./screenshots";

describe("comparesScreenshots (#463)", () => {
  it("compares in CI, so a missing or different baseline fails there", () => {
    expect(comparesScreenshots({ CI: "true" })).toBe(true);
  });

  it("does not compare on a developer's machine, whose fonts are not the Playwright image's", () => {
    expect(comparesScreenshots({})).toBe(false);
  });

  it("does as E2E_SCREENSHOTS says when it is set: the baselines' script and CI's screenshots job say 1, CI's other e2e run 0", () => {
    expect(comparesScreenshots({ E2E_SCREENSHOTS: "1" })).toBe(true);
    expect(comparesScreenshots({ CI: "true", E2E_SCREENSHOTS: "0" })).toBe(false);
  });
});
