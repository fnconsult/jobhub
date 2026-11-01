import { describe, expect, it } from "vitest";
import { isPublicPage, splitLocalePrefix, urlLocale } from "./locale-header";

const PUBLIC = ["/", "/desabonnement", "/nouveautes", "/legal/cgv", "/legal/cgu/2026-01-01", "/aide", "/connexion", "/connexion/back-office", "/compte/supprime"];

describe("the public pages (#544, #545)", () => {
  it("are the home page, Nouveautés, Légal, Aide, sign-in, the unsubscribe page and the deleted account's", () => {
    for (const path of PUBLIC) expect(isPublicPage(path), path).toBe(true);
    for (const path of ["/compte", "/admin", "/api/health", "/espace-coach", "/legalese", "/candidatures"]) expect(isPublicPage(path), path).toBe(false);
  });
});

describe("splitLocalePrefix (#545)", () => {
  it("reads English from /en, the home page from /en alone; anything else is French", () => {
    expect(splitLocalePrefix("/en/legal/cgu")).toEqual({ locale: "en", pathname: "/legal/cgu" });
    expect(splitLocalePrefix("/en")).toEqual({ locale: "en", pathname: "/" });
    expect(splitLocalePrefix("/legal/cgu")).toEqual({ locale: "fr", pathname: "/legal/cgu" });
    expect(splitLocalePrefix("/entretiens")).toEqual({ locale: "fr", pathname: "/entretiens" });
  });
});

describe("urlLocale", () => {
  it("serves a public page under /en with its French slug, in English for a Visitor (#545)", () => {
    for (const path of PUBLIC) {
      expect(urlLocale(`/en${path === "/" ? "" : path}`, null), path).toEqual({ rewrite: path, visitor: "en", url: "en" });
    }
  });

  it("without /en, a public page's URL is French, a signed-in Candidate's Interface Language still first", () => {
    expect(urlLocale("/legal/cgu", null)).toEqual({ url: "fr" });
  });

  it("lets `lang` choose the language of every public page, whoever reads it (#544)", () => {
    for (const path of PUBLIC) expect(urlLocale(path, "en"), path).toEqual({ chosen: "en", url: "en" });
    expect(urlLocale("/en/legal/cgu", "fr")).toEqual({ rewrite: "/legal/cgu", visitor: "en", chosen: "fr", url: "fr" });
  });

  it("elsewhere, offers `lang` or /en only as a Visitor's choice, and serves nothing under /en", () => {
    expect(urlLocale("/une-page-introuvable", "en")).toEqual({ visitor: "en", url: "en" });
    expect(urlLocale("/compte", "en")).toEqual({ visitor: "en", url: "en" });
    expect(urlLocale("/en/admin", null)).toEqual({ visitor: "en", url: "en" });
    expect(urlLocale("/compte", null)).toEqual({});
  });

  it("ignores a language the app does not speak", () => {
    expect(urlLocale("/legal/cgv", "de")).toEqual({ url: "fr" });
    expect(urlLocale("/legalese", "de")).toEqual({});
  });
});
