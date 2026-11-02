import { describe, expect, it } from "vitest";
import { guestTermsToAccept, sentenceParts, SIDE_PANEL_LINKS, siteHref, siteLanguage, versionDay } from "./guest-terms";

const cgu = { version: "2026-06-01", url: "/legal/cgu/2026-06-01" };

describe("the Guest's box (#550)", () => {
  it("asks for the CGU version in effect until the Guest has accepted it in this session", () => {
    expect(guestTermsToAccept(cgu, undefined)).toEqual(cgu);
    expect(guestTermsToAccept(cgu, { version: "2026-06-01", acceptedAt: 0 })).toBeNull();
    // A version accepted earlier in the session is not this one: asked again.
    expect(guestTermsToAccept(cgu, { version: "2026-01-01", acceptedAt: 0 })).toEqual(cgu);
  });

  it("is not shown while no CGU version is in effect", () => {
    expect(guestTermsToAccept(null, undefined)).toBeNull();
  });

  it("names the version by its day: 01/06/2026 in French, written out in English", () => {
    expect(versionDay("2026-06-01", "fr")).toBe("01/06/2026");
    expect(versionDay("2026-06-01", "en")).toBe("June 1, 2026");
  });

  it("cuts its sentence where its links stand", () => {
    const marker = (slot: string) => `\u0000${slot}\u0000`;
    expect(sentenceParts(`J'accepte les ${marker("terms")} (version du 01/06/2026) et j'ai lu l'${marker("privacy")}`, ["terms", "privacy"], marker)).toEqual([
      { text: "J'accepte les " },
      { slot: "terms" },
      { text: " (version du 01/06/2026) et j'ai lu l'" },
      { slot: "privacy" },
    ]);
    expect(sentenceParts("Rien à lier", ["terms"], marker)).toEqual([{ text: "Rien à lier" }]);
  });
});

describe("the Side Panel's foot (#550)", () => {
  it("leads to Aide (« L'extension »), Confidentialité and CGU", () => {
    expect(SIDE_PANEL_LINKS.map(({ path }) => path)).toEqual(["/aide/extension", "/legal/confidentialite", "/legal/cgu"]);
  });

  it("opens the web app in the browser's language: under /en in English, French otherwise", () => {
    expect(siteLanguage("en-US")).toBe("en");
    expect(siteLanguage("en")).toBe("en");
    expect(siteLanguage("fr-FR")).toBe("fr");
    expect(siteLanguage("de-DE")).toBe("fr");
    expect(siteLanguage(undefined)).toBe("fr");
    expect(siteHref("https://jobbbox.ai", "/legal/cgu", "en")).toBe("https://jobbbox.ai/en/legal/cgu");
    expect(siteHref("https://jobbbox.ai", "/legal/cgu", "fr")).toBe("https://jobbbox.ai/legal/cgu");
  });
});
