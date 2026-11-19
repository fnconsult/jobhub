import { describe, expect, it } from "vitest";
import { gettingStarted, gettingStartedOpen, GETTING_STARTED_DAYS, installsChromeExtensions, type GettingStartedAccount } from "./getting-started";

// #1069: « Pour bien commencer », in an empty conversation's help, above « Souvent demandé ». What the Candidate has not
// used yet, in a fixed order, during the account's first 14 days; found without AI, the same on the web and in the app.

const CREATED = new Date("2026-11-02T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(CREATED.getTime() + 3 * DAY);

/** A new account: no ATS Score, no Capture from the extension, the extension on the Chrome Web Store. */
const newAccount = (more: Partial<GettingStartedAccount> = {}): GettingStartedAccount => ({
  createdAt: CREATED.toISOString(),
  atsScore: false,
  extensionCapture: false,
  extensionPublished: true,
  ...more,
});
const onChrome = { now: NOW, installsExtensions: true };
const keys = (items: { key: string }[]) => items.map((item) => item.key);

describe("gettingStarted — « Pour bien commencer »", () => {
  it("lists, for a new account on Chrome on a computer, the ATS Score then the extension, each with its Help Article", () => {
    const items = gettingStarted(newAccount(), onChrome, "fr");
    expect(items.map(({ key, article }) => [key, article.id])).toEqual([
      ["atsScore", "glossary-ats-score"],
      ["extension", "page-install-extension"],
    ]);
    expect(gettingStarted(newAccount(), onChrome, "en").map(({ article }) => article.locale)).toEqual(["en", "en"]);
  });

  it("leaves out the ATS Score once one exists for a CV of the account", () => {
    expect(keys(gettingStarted(newAccount({ atsScore: true }), onChrome, "fr"))).toEqual(["extension"]);
  });

  it("leaves out the extension once the account has a Capture from it", () => {
    expect(keys(gettingStarted(newAccount({ extensionCapture: true }), onChrome, "fr"))).toEqual(["atsScore"]);
  });

  it("is empty once there is nothing left to show, before the 14 days are over", () => {
    expect(gettingStarted(newAccount({ atsScore: true, extensionCapture: true }), onChrome, "fr")).toEqual([]);
  });

  it("is shown during the 14 days after the account's creation, then never, even with features unused", () => {
    const at = (ms: number) => ({ now: new Date(CREATED.getTime() + ms), installsExtensions: true });
    expect(GETTING_STARTED_DAYS).toBe(14);
    expect(keys(gettingStarted(newAccount(), at(0), "fr"))).toEqual(["atsScore", "extension"]);
    expect(keys(gettingStarted(newAccount(), at(14 * DAY - 1), "fr"))).toEqual(["atsScore", "extension"]);
    expect(gettingStarted(newAccount(), at(14 * DAY), "fr")).toEqual([]);
    expect(gettingStarted(newAccount(), at(40 * DAY), "fr")).toEqual([]);
    // The account's creation date as the server sends it, or as a Date.
    expect(keys(gettingStarted(newAccount({ createdAt: CREATED }), at(DAY), "fr"))).toEqual(["atsScore", "extension"]);
  });

  it("leaves out the extension on a browser that cannot install it (not Chrome, a phone, the app)", () => {
    expect(keys(gettingStarted(newAccount(), { now: NOW, installsExtensions: false }, "fr"))).toEqual(["atsScore"]);
  });

  it("leaves out the extension while it is not published (« L'extension arrive bientôt »)", () => {
    expect(keys(gettingStarted(newAccount({ extensionPublished: false }), onChrome, "fr"))).toEqual(["atsScore"]);
  });

  it("is empty without an account to read (signed out, or not read yet)", () => {
    expect(gettingStarted(null, onChrome, "fr")).toEqual([]);
  });
});

describe("gettingStartedOpen — the 14 days", () => {
  it("is open from the account's creation for 14 days", () => {
    expect(gettingStartedOpen(CREATED, CREATED)).toBe(true);
    expect(gettingStartedOpen(CREATED.toISOString(), new Date(CREATED.getTime() + 14 * DAY - 1))).toBe(true);
    expect(gettingStartedOpen(CREATED, new Date(CREATED.getTime() + 14 * DAY))).toBe(false);
  });
});

describe("installsChromeExtensions — a browser that installs extensions from the Chrome Web Store, on a computer", () => {
  const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  const EDGE = `${CHROME_WINDOWS} Edg/130.0.0.0`;
  const OPERA = `${CHROME_WINDOWS} OPR/115.0.0.0`;
  const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
  const CHROME_ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  const CHROME_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";
  const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
  const brands = (...names: string[]) => names.map((brand) => ({ brand, version: "130" }));
  const desktop = (...names: string[]) => ({ brands: brands("Not?A_Brand", ...names), mobile: false, platform: "Windows" });

  it("says yes for Chrome, Edge and other Chromium browsers on a computer, by their brands", () => {
    expect(installsChromeExtensions({ userAgent: CHROME_WINDOWS, userAgentData: desktop("Chromium", "Google Chrome") })).toBe(true);
    expect(installsChromeExtensions({ userAgent: EDGE, userAgentData: desktop("Chromium", "Microsoft Edge") })).toBe(true);
    expect(installsChromeExtensions({ userAgent: CHROME_WINDOWS, userAgentData: desktop("Chromium", "Brave") })).toBe(true);
    expect(installsChromeExtensions({ userAgent: CHROME_WINDOWS, userAgentData: desktop("Chromium") })).toBe(true);
  });

  it("says yes for Chrome and Edge on a computer by their User-Agent, where the brands are not given", () => {
    expect(installsChromeExtensions({ userAgent: CHROME_WINDOWS })).toBe(true);
    expect(installsChromeExtensions({ userAgent: CHROME_MAC, maxTouchPoints: 0 })).toBe(true);
    expect(installsChromeExtensions({ userAgent: EDGE })).toBe(true);
    // Brands given but empty (a User-Agent set by hand): the User-Agent decides.
    expect(installsChromeExtensions({ userAgent: CHROME_WINDOWS, userAgentData: { brands: [], mobile: false, platform: "" } })).toBe(true);
  });

  it("says no for a browser other than Chrome: Firefox, Safari, Opera (which needs an add-on for the store)", () => {
    expect(installsChromeExtensions({ userAgent: FIREFOX })).toBe(false);
    expect(installsChromeExtensions({ userAgent: SAFARI })).toBe(false);
    expect(installsChromeExtensions({ userAgent: OPERA })).toBe(false);
    expect(installsChromeExtensions({ userAgent: OPERA, userAgentData: desktop("Chromium", "Opera") })).toBe(false);
  });

  it("says no on a phone or a tablet, Chrome included", () => {
    expect(installsChromeExtensions({ userAgent: CHROME_ANDROID })).toBe(false);
    expect(installsChromeExtensions({ userAgent: CHROME_ANDROID, userAgentData: { brands: brands("Chromium", "Google Chrome"), mobile: true, platform: "Android" } })).toBe(false);
    // An Android tablet says it is not mobile.
    expect(installsChromeExtensions({ userAgent: CHROME_ANDROID_TABLET, userAgentData: { brands: brands("Chromium", "Google Chrome"), mobile: false, platform: "Android" } })).toBe(false);
    expect(installsChromeExtensions({ userAgent: CHROME_ANDROID_TABLET })).toBe(false);
    expect(installsChromeExtensions({ userAgent: CHROME_IPHONE })).toBe(false);
    // An iPad asks for the computer's site: a Mac's User-Agent, but a touch screen.
    expect(installsChromeExtensions({ userAgent: CHROME_MAC, maxTouchPoints: 5 })).toBe(false);
  });
});
