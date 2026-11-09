import { describe, expect, it } from "vitest";
import { browserFamilyOf, browserOf, pagePath, whereSentFrom } from "./context";

describe("A Signalement's context (#374, #283)", () => {
  describe("the page, as its path alone", () => {
    it.each([
      ["/candidatures/0b6c2f1e-1111-4111-8111-111111111111/documents?onglet=cv&email=marie@example.fr#lettre", "/candidatures/0b6c2f1e-1111-4111-8111-111111111111/documents"],
      ["/compte/preferences", "/compte/preferences"],
      ["/?q=daf", "/"],
      ["/profils#haut", "/profils"],
      ["https://jobbbox.ai/offres/42?source=apec", "/offres/42"],
    ])("keeps %s as %s, without its query string or #…", (address, path) => {
      expect(pagePath(address)).toBe(path);
    });

    it.each([[""], ["javascript:alert(1)"], ["offres/42"], [null], [undefined], [42]])("has no path for %s", (address) => {
      expect(pagePath(address)).toBeNull();
    });

    it("cuts a path too long to be a page of Jobbbox", () => {
      expect(pagePath(`/${"a".repeat(1_000)}`)!.length).toBe(300);
    });
  });

  describe("the browser, as name, major version and operating system", () => {
    it.each([
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Safari/537.36", "Chrome 141, Mac"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.81", "Edge 140, Windows"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0", "Firefox 143, Windows"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15", "Safari 26, Mac"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", "Safari 18, iOS"],
      ["Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1", "Chrome 141, iOS"],
      ["Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", "Chrome 141, Android"],
      ["Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36", "Samsung Internet 28, Android"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/123.0.0.0", "Opera 123, Windows"],
      ["Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0", "Firefox 143, Linux"],
      ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "Chrome 141, ChromeOS"],
    ])("reads %s as « %s »", (userAgent, browser) => {
      expect(browserOf(userAgent)).toBe(browser);
    });

    it("tells the family and major version alone, without the system, for an Extension Event (#924)", () => {
      expect(browserFamilyOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Safari/537.36")).toBe("Chrome 141");
      expect(browserFamilyOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57")).toBe("Edge 141");
      expect(browserFamilyOf("curl/8.7.1")).toBeNull();
      expect(browserFamilyOf(null)).toBeNull();
    });

    it("names what it cannot tell, never keeping the raw user agent", () => {
      expect(browserOf("curl/8.7.1")).toBe("Navigateur inconnu, système inconnu");
      expect(browserOf("Mozilla/5.0 (Windows NT 10.0) MonNavigateur/3 marie@example.fr")).toBe("Navigateur inconnu, Windows");
      expect(browserOf(null)).toBeNull();
      expect(browserOf("")).toBeNull();
    });
  });

  describe("from the Jobbbox app (#690), its version and system, as its form says before sending", () => {
    // What a native fetch says of itself: neither a browser nor a system a person can read.
    const IOS_FETCH = "Jobbbox/1 CFNetwork/3826.500.131 Darwin/24.5.0";
    const ANDROID_FETCH = "okhttp/4.12.0";

    it.each([
      [IOS_FETCH, "1.4.0 (iOS 18.6)", "App Jobbbox 1.4.0, iOS 18.6"],
      [ANDROID_FETCH, "1.4.0 (Android 34)", "App Jobbbox 1.4.0, Android 34"],
      [ANDROID_FETCH, "(Android 34)", "App Jobbbox, Android 34"],
    ])("reads %s with « %s » as « %s »", (userAgent, appDevice, kept) => {
      expect(whereSentFrom({ userAgent, appDevice })).toBe(kept);
    });

    it("reads the browser as before without it, or with anything else in it", () => {
      expect(whereSentFrom({ userAgent: ANDROID_FETCH, appDevice: null })).toBe("Navigateur inconnu, système inconnu");
      expect(whereSentFrom({ userAgent: ANDROID_FETCH, appDevice: "marie@example.fr" })).toBe("Navigateur inconnu, système inconnu");
      expect(whereSentFrom({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0" })).toBe("Firefox 143, Windows");
    });
  });
});
