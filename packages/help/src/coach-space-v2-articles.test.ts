import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { helpForUnanswered, helpSuggestions, oftenAsked, onThisPage } from "./coach-help";
import { readHelpContent } from "./content";
import { article, articleFor, articles, articlesFor, backOfficeHelpTopics, helpCentreArticle, helpCentreTopics, search } from "./index";
import { servedArticles } from "./requirements";
import { HELP_LOCALES, type HelpArticle } from "./types";

// #867 (ADR-0107): the Human Coach epic's Help Articles wait for « Espace coach v2 ». Off, every reader gets the articles
// main served, with main's text; on, the epic's: the articles it added, and each `<id>.v2.md` in its base's place. The
// Back Office's (an Administrator's) are not gated: the Back Office is the same in both states.

const entry = (fields: Partial<HelpArticle> & Pick<HelpArticle, "id" | "title">): HelpArticle => ({
  locale: "fr",
  kind: "faq",
  audience: "candidate",
  topic: "utiliser",
  synonyms: [],
  route: null,
  motion: null,
  microAnimations: [],
  body: "Un texte.",
  ...fields,
});

describe("servedArticles — what « Espace coach v2 » serves", () => {
  const BASE = entry({ id: "faq-seance", title: "Réserver une séance" });
  const V2 = entry({ id: "faq-seance", title: "Réserver une séance, le nouveau parcours", requires: "coach-space-v2" });
  const ADDED = entry({ id: "faq-annuler", title: "Annuler une séance", requires: "coach-space-v2" });
  const OTHER = entry({ id: "faq-autre", title: "Autre chose" });
  const ALL = [BASE, V2, ADDED, OTHER];

  it("off (the default): only the articles requiring nothing, in their order", () => {
    expect(servedArticles(ALL)).toEqual([BASE, OTHER]);
    expect(servedArticles(ALL, { coachSpaceV2: false })).toEqual([BASE, OTHER]);
  });

  it("on: the added articles, and each `.v2` in the place of the article of its id", () => {
    expect(servedArticles(ALL, { coachSpaceV2: true })).toEqual([V2, ADDED, OTHER]);
  });
});

describe("this build's articles, « Espace coach v2 » off and on", () => {
  it.each(HELP_LOCALES)("off, in %s: none requires a setting, and `articles` and the defaults read them", (locale) => {
    const off = articlesFor(locale);
    expect(off.filter((found) => found.requires)).toEqual([]);
    expect(articles(locale)).toBe(off);
    expect(articlesFor(locale, { coachSpaceV2: false })).toBe(off);
    expect(helpCentreTopics(locale)).toEqual(helpCentreTopics(locale, off));
  });

  it.each(HELP_LOCALES)("on, in %s: one article per id, 46 added and 12 replaced by their `.v2`, in the same order as off", (locale) => {
    const off = articlesFor(locale);
    const on = articlesFor(locale, { coachSpaceV2: true });
    const ids = on.map((found) => found.id);
    expect(new Set(ids).size).toBe(ids.length);
    const added = on.filter((found) => found.requires && !off.some((other) => other.id === found.id));
    const replaced = on.filter((found) => found.requires && off.some((other) => other.id === found.id));
    expect([added.length, replaced.length]).toEqual([46, 12]);
    expect(on.length).toBe(off.length + 46);
    expect(off.filter((found) => !on.includes(found)).map((found) => found.id).sort()).toEqual(replaced.map((found) => found.id).sort());
  });

  it("each `.v2` and each added article waits for the setting in both languages", () => {
    const required = (locale: "fr" | "en") => articlesFor(locale, { coachSpaceV2: true }).filter((found) => found.requires).map((found) => `${found.id} ${found.requires}`);
    expect(required("en").sort()).toEqual(required("fr").sort());
  });

  it("never gates an Administrator's article: the Back Office's help is the same off and on", () => {
    expect(articlesFor("fr", { coachSpaceV2: true }).filter((found) => found.requires && found.audience === "administrator")).toEqual([]);
    expect(backOfficeHelpTopics("fr", articlesFor("fr", { coachSpaceV2: true }))).toEqual(backOfficeHelpTopics("fr"));
    expect(search("coachs humains", "fr", { scope: "backOffice", from: articlesFor("fr", { coachSpaceV2: true }) })).toEqual(search("coachs humains", "fr", { scope: "backOffice" }));
  });

  it("serves an added article's page in the Help Centre on only: off, its address is no article (a 404)", () => {
    expect(helpCentreArticle("espace-coach", "page-coach-earnings", "fr")).toBeNull();
    expect(helpCentreArticle("espace-coach", "page-coach-earnings", "fr", articlesFor("fr", { coachSpaceV2: true }))?.requires).toBe("coach-space-v2");
    expect(article("faq-coaching-cancellation", "fr")).toBeNull();
    expect(article("faq-coaching-cancellation", "fr", { coachSpaceV2: true })?.requires).toBe("coach-space-v2");
  });

  it("serves a replaced article's base text off, its `.v2` text on, at the same address", () => {
    const off = helpCentreArticle("utiliser", "tutorial-book-coaching-session", "fr")!;
    const on = helpCentreArticle("utiliser", "tutorial-book-coaching-session", "fr", articlesFor("fr", { coachSpaceV2: true }))!;
    expect(off.requires).toBeUndefined();
    expect(on.requires).toBe("coach-space-v2");
    expect(off.body).not.toBe(on.body);
    // Main's booking flow: « J'ai réservé : saisir la date », filmed by the Motion Script while the setting is off.
    expect(off.body).toContain("J'ai réservé");
  });

  it("finds a page's article « Sur cette page » of the state: /compte/rappels is Mon compte's off, its own page's on", () => {
    expect(articleFor("/compte/rappels", "fr")?.id).toBe("page-account");
    expect(articleFor("/compte/rappels", "fr", { from: articlesFor("fr", { coachSpaceV2: true }) })?.id).toBe("page-account-reminders");
  });
});

describe("the Coach Panel's help (coach-help), « Espace coach v2 » off and on", () => {
  it("suggests and offers an added article on only", () => {
    const ids = (found: HelpArticle[]) => found.map((each) => each.id);
    expect(ids(helpSuggestions("annuler une séance de coaching", "fr"))).not.toContain("faq-coaching-cancellation");
    expect(ids(helpSuggestions("annuler une séance de coaching", "fr", "candidate", { coachSpaceV2: true }))).toContain("faq-coaching-cancellation");
    expect(ids(helpForUnanswered("annuler une séance de coaching", "fr"))).not.toContain("faq-coaching-cancellation");
    expect(ids(helpForUnanswered("annuler une séance de coaching", "fr", "candidate", { coachSpaceV2: true }))).toContain("faq-coaching-cancellation");
  });

  it("shows « Sur cette page » the article, and the text, of the state", () => {
    expect(onThisPage("/coachs/annulations", "fr")?.article.id).toBe("page-human-coaches");
    expect(onThisPage("/coachs/annulations", "fr", "candidate", { coachSpaceV2: true })?.article.id).toBe("page-coaching-cancellations");
    expect(onThisPage("/agenda", "fr")?.article).toBe(article("page-agenda", "fr"));
    expect(onThisPage("/agenda", "fr", "candidate", { coachSpaceV2: true })?.article).toBe(article("page-agenda", "fr", { coachSpaceV2: true }));
  });

  it("offers the same three frequent questions in both states", () => {
    expect(oftenAsked("fr", "candidate", { coachSpaceV2: true }).map((found) => found.id)).toEqual(oftenAsked("fr").map((found) => found.id));
  });
});

/** Writes `files` ({ "fr/faq-x.md": "…" }) into a fresh articles directory. */
function articlesDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "help-articles-"));
  mkdirSync(path.join(dir, "fr"));
  mkdirSync(path.join(dir, "en"));
  for (const [file, markdown] of Object.entries(files)) writeFileSync(path.join(dir, file), markdown);
  return dir;
}

const faq = (extra = "", title = "Une question ?") => `---
kind: faq
audience: candidate
topic: utiliser
title: ${title}
synonyms: [question]
${extra}---
Une réponse.
`;
const page = (route: string, extra = "") => `---
kind: page
audience: candidate
topic: utiliser
title: Une page
synonyms: [page]
route: ${route}
${extra}---
Une page.
`;
const V2 = "requires: coach-space-v2\nreplaces: faq-x\n";

describe("readHelpContent — `requires` and `replaces` (#867)", () => {
  it("reads a `.v2.md` as the article of its base's id, requiring the setting", () => {
    const content = readHelpContent(articlesDir({ "fr/faq-x.md": faq(), "en/faq-x.md": faq(), "fr/faq-x.v2.md": faq(V2, "Nouvelle ?"), "en/faq-x.v2.md": faq(V2, "New?") }));
    expect(content.fr.map((found) => [found.id, found.title, found.requires])).toEqual([
      ["faq-x", "Une question ?", undefined],
      ["faq-x", "Nouvelle ?", "coach-space-v2"],
    ]);
    expect("requires" in content.fr[0]!).toBe(false);
  });

  it("fails when the languages disagree on the setting an article waits for", () => {
    expect(() => readHelpContent(articlesDir({ "fr/faq-y.md": faq("requires: coach-space-v2\n"), "en/faq-y.md": faq() }))).toThrow(
      /en\/faq-y\.md: it requires \(nothing\), the French one coach-space-v2/,
    );
  });

  it("fails on an unknown requirement, or a `replaces` outside a `.v2.md`", () => {
    expect(() => readHelpContent(articlesDir({ "fr/faq-y.md": faq("requires: autre\n"), "en/faq-y.md": faq("requires: autre\n") }))).toThrow(/requires must be coach-space-v2/);
    expect(() => readHelpContent(articlesDir({ "fr/faq-y.md": faq("replaces: faq-z\n"), "en/faq-y.md": faq("replaces: faq-z\n") }))).toThrow(/only an article's <id>\.v2\.md replaces it/);
  });

  it("fails on a `.v2.md` without its base, its requirement, or replacing another id", () => {
    expect(() => readHelpContent(articlesDir({ "fr/faq-x.v2.md": faq(V2), "en/faq-x.v2.md": faq(V2) }))).toThrow(/it replaces faq-x\.md, which is missing/);
    expect(() => readHelpContent(articlesDir({ "fr/faq-x.md": faq(), "en/faq-x.md": faq(), "fr/faq-x.v2.md": faq("replaces: faq-x\n"), "en/faq-x.v2.md": faq("replaces: faq-x\n") }))).toThrow(
      /a \.v2\.md article requires the setting it waits for/,
    );
    const wrong = "requires: coach-space-v2\nreplaces: faq-z\n";
    expect(() => readHelpContent(articlesDir({ "fr/faq-x.md": faq(), "en/faq-x.md": faq(), "fr/faq-x.v2.md": faq(wrong), "en/faq-x.v2.md": faq(wrong) }))).toThrow(
      /a \.v2\.md article replaces the article it is named after: replaces: faq-x/,
    );
  });

  it("lets a `.v2` explain its base's route, and fails on two page articles of one route in either state", () => {
    const pageV2 = "requires: coach-space-v2\nreplaces: page-a\n";
    expect(() => readHelpContent(articlesDir({ "fr/page-a.md": page("/agenda"), "en/page-a.md": page("/agenda"), "fr/page-a.v2.md": page("/agenda", pageV2), "en/page-a.v2.md": page("/agenda", pageV2) }))).not.toThrow();
    const added = "requires: coach-space-v2\n";
    expect(() => readHelpContent(articlesDir({ "fr/page-a.md": page("/agenda"), "en/page-a.md": page("/agenda"), "fr/page-b.md": page("/agenda", added), "en/page-b.md": page("/agenda", added) }))).toThrow(
      /fr\/page-b\.md: page-a already explains \/agenda \(« Espace coach v2 » on\)/,
    );
  });
});
