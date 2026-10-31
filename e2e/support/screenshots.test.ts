import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comparesEmailScreenshots, comparesScreenshots } from "./screenshots";

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

  it("compares when the browser runs in the Playwright container (PW_TEST_CONNECT_WS_ENDPOINT), the baselines' renderer", () => {
    expect(comparesScreenshots({ PW_TEST_CONNECT_WS_ENDPOINT: "ws://127.0.0.1:3464/" })).toBe(true);
    expect(comparesScreenshots({ PW_TEST_CONNECT_WS_ENDPOINT: "ws://127.0.0.1:3464/", E2E_SCREENSHOTS: "0" })).toBe(false);
  });
});

describe("comparesEmailScreenshots (#472)", () => {
  it("compares on macOS, which has baselines of its own (-darwin.png)", () => {
    expect(comparesEmailScreenshots({}, "darwin")).toBe(true);
  });

  it("compares the Linux baselines only where they are drawn, the Playwright image: not on any Linux machine", () => {
    expect(comparesEmailScreenshots({}, "linux")).toBe(false);
    expect(comparesEmailScreenshots({ E2E_SCREENSHOTS: "1" }, "linux")).toBe(true);
    expect(comparesEmailScreenshots({ CI: "true" }, "linux")).toBe(true);
  });

  it("does as E2E_SCREENSHOTS says when it is set, on macOS too", () => {
    expect(comparesEmailScreenshots({ E2E_SCREENSHOTS: "0" }, "darwin")).toBe(false);
    expect(comparesEmailScreenshots({ CI: "true", E2E_SCREENSHOTS: "0" }, "linux")).toBe(false);
  });
});

// A Linux machine is not the Playwright image: a Chromium elsewhere draws text otherwise (grayscale where the image's
// baselines have colour fringes), and a spec that compares on `process.platform === "linux"` fails there on screens
// nobody changed. Every spec with a toHaveScreenshot asks this module whether to compare.
describe("the screenshot specs", () => {
  const e2e = path.resolve(import.meta.dirname, "..");
  const specs = readdirSync(e2e)
    .filter((file) => file.endsWith(".spec.ts"))
    .map((file) => ({ file, source: readFileSync(path.join(e2e, file), "utf8") }))
    .filter(({ source }) => /\.toHaveScreenshot\(/.test(source));

  it("are found", () => {
    expect(specs.map(({ file }) => file)).toEqual(expect.arrayContaining(["email-html.spec.ts", "shell-screenshots.spec.ts"]));
  });

  it("each compare only when e2e/support/screenshots.ts says so, never on the platform alone", () => {
    const ungated = specs.filter(({ source }) => !/\bcompares(Email)?Screenshots\(/.test(source) || /process\.platform\s*===\s*"linux"/.test(source));
    expect(ungated.map(({ file }) => file)).toEqual([]);
  });
});
