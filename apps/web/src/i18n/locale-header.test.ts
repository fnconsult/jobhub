import { describe, expect, it } from "vitest";
import { englishHelpCentrePath, urlLocale } from "./locale-header";

describe("urlLocale (#544)", () => {
  it("lets `lang` choose the language of every public page", () => {
    for (const path of ["/desabonnement", "/nouveautes", "/legal/cgv", "/aide", "/connexion", "/connexion/back-office", "/compte/supprime"]) {
      expect(urlLocale(path, "en"), path).toEqual({ chosen: "en" });
    }
  });

  it("elsewhere, offers it only as a Visitor's choice: a signed-in Candidate's Interface Language comes first", () => {
    expect(urlLocale("/une-page-introuvable", "en")).toEqual({ visitor: "en" });
    expect(urlLocale("/compte", "en")).toEqual({ visitor: "en" });
  });

  it("ignores a language the app does not speak, or none", () => {
    expect(urlLocale("/legal/cgv", "de")).toEqual({});
    expect(urlLocale("/legal/cgv", null)).toEqual({});
    expect(urlLocale("/legalese", "en")).toEqual({ visitor: "en" });
  });
});

describe("englishHelpCentrePath (#549)", () => {
  it("serves /en/aide/… from the French address", () => {
    expect(englishHelpCentrePath("/en/aide")).toBe("/aide");
    expect(englishHelpCentrePath("/en/aide/extension")).toBe("/aide/extension");
    expect(englishHelpCentrePath("/en/aide/extension/tutorial-extension-save-job-offer")).toBe("/aide/extension/tutorial-extension-save-job-offer");
  });

  it("leaves every other address alone", () => {
    for (const path of ["/aide", "/en", "/en/legal/cgu", "/en/aides", "/fr/aide", "/x/en/aide"]) expect(englishHelpCentrePath(path), path).toBeNull();
  });
});
