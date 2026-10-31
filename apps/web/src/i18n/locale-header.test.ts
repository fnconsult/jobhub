import { describe, expect, it } from "vitest";
import { urlLocale } from "./locale-header";

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
