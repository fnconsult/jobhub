import { readdirSync, readFileSync } from "node:fs";
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

  // #544: the shell's spec decided by itself, comparing on any Linux machine, so a Linux that is not the Playwright
  // image (CI's other e2e run, a cloud sandbox) failed on its fonts. The emails' spec keeps a baseline per platform, in
  // its own project (playwright.config.ts), and is left out.
  it("is what every spec comparing the web app's screens with the Playwright image's baselines asks", () => {
    const specs = readdirSync("e2e").filter((file) => file.endsWith(".spec.ts") && file !== "email-html.spec.ts");
    const comparing = specs.filter((file) => /\.toHaveScreenshot\(/.test(readFileSync(`e2e/${file}`, "utf8")));
    expect(comparing).toContain("shell-screenshots.spec.ts");
    expect(comparing.filter((file) => !readFileSync(`e2e/${file}`, "utf8").includes("comparesScreenshots()"))).toEqual([]);
  });
});
