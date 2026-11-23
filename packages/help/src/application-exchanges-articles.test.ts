import { describe, expect, it } from "vitest";
import { articleFor, articlesFor } from "./index";
import { HELP_LOCALES } from "./types";

// #1099 (ADR-0115, proposed): the Applications' Exchanges ship behind APPLICATION_EXCHANGES_ENABLED, off until their Legal
// Review. Their Help Articles (the « Échanges » Section's page article and the glossary's « Échange ») are served only
// while it is on: off, no reader (the Help Centre, its search, the AI Coach) names a Section no Candidate sees.

describe("the Exchanges' Help Articles (#1099)", () => {
  it("are served only while the Applications' Exchanges are on", () => {
    for (const locale of HELP_LOCALES) {
      const off = articlesFor(locale, {}).map((article) => article.id);
      const on = articlesFor(locale, { applicationExchanges: true }).map((article) => article.id);
      expect(off).not.toContain("glossary-exchange");
      expect(off).not.toContain("page-application-exchanges");
      expect(on).toEqual(expect.arrayContaining(["glossary-exchange", "page-application-exchanges"]));
    }
  });

  it("give the « Échanges » Section its own page article while on; the Application's page article otherwise", () => {
    expect(articleFor("/candidatures/a1/echanges", "fr", { from: articlesFor("fr", { applicationExchanges: true }) })?.id).toBe("page-application-exchanges");
    expect(articleFor("/candidatures/a1/echanges", "en", { from: articlesFor("en", { applicationExchanges: true }) })?.title).toBe("An application's Exchanges section");
    expect(articleFor("/candidatures/a1/echanges", "fr", { from: articlesFor("fr", {}) })?.id).toBe("page-application");
  });
});
