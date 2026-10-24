import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatedModulePath, HelpContentError, readHelpContent, renderArticlesModule } from "./content";

/** Writes `files` ({ "fr/faq-x.md": "…" }) into a fresh articles directory. */
function articlesDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "help-articles-"));
  mkdirSync(path.join(dir, "fr"));
  mkdirSync(path.join(dir, "en"));
  for (const [file, markdown] of Object.entries(files)) writeFileSync(path.join(dir, file), markdown);
  return dir;
}

const relanceFr = `---
kind: faq
title: Comment relancer un recruteur ?
synonyms: [relance, rappeler, "sans réponse"]
---
Votre coach propose un e-mail de **relance**.

Jobbbox n'envoie rien à votre place.
`;
const relanceEn = `---
kind: faq
title: How do I follow up with a recruiter?
synonyms: [follow-up, chase]
---
Your coach drafts a follow-up email.
`;

describe("readHelpContent — the Help Articles of a directory", () => {
  it("reads each article in French and English, with its front matter and Markdown body", () => {
    const content = readHelpContent(articlesDir({ "fr/faq-follow-up.md": relanceFr, "en/faq-follow-up.md": relanceEn }));

    expect(content.fr).toEqual([
      {
        id: "faq-follow-up",
        locale: "fr",
        kind: "faq",
        title: "Comment relancer un recruteur ?",
        synonyms: ["relance", "rappeler", "sans réponse"],
        route: null,
        body: "Votre coach propose un e-mail de **relance**.\n\nJobbbox n'envoie rien à votre place.",
      },
    ]);
    expect(content.en.map((article) => [article.id, article.locale, article.title])).toEqual([
      ["faq-follow-up", "en", "How do I follow up with a recruiter?"],
    ]);
  });

  it("fails when an article has no English twin, or no French one", () => {
    expect(() => readHelpContent(articlesDir({ "fr/faq-follow-up.md": relanceFr }))).toThrow(
      new HelpContentError("en/faq-follow-up.md is missing: every Help Article is written in French and in English"),
    );
    expect(() => readHelpContent(articlesDir({ "en/faq-follow-up.md": relanceEn }))).toThrow(/fr\/faq-follow-up\.md is missing/);
  });

  const page = (fields: string, body = "Elle rassemble vos candidatures.") => `---\n${fields}\n---\n${body}\n`;
  const valid = "kind: page\ntitle: Mes candidatures\nsynonyms: [suivi]\nroute: /candidatures";

  it.each([
    ["an unknown kind", page(valid.replace("kind: page", "kind: tutorial")), /kind must be page, glossary or faq/],
    ["no title", page(valid.replace("title: Mes candidatures", "")), /title is missing/],
    ["synonyms that are not a list", page(valid.replace("[suivi]", "suivi")), /synonyms must be a list/],
    ["a page article without a route", page(valid.replace("route: /candidatures", "")), /a page article needs its route/],
    ["a route on a glossary entry", page(valid.replace("kind: page", "kind: glossary")), /only a page article has a route/],
    ["a route that is not an app path", page(valid.replace("route: /candidatures", "route: candidatures")), /route must start with \//],
    ["an empty body", page(valid, ""), /the body is empty/],
    ["an image", page(valid, "Voyez ![la page](capture.png)."), /no images/],
  ])("fails on %s, naming the file", (_case, markdown, problem) => {
    const enTwin = page(valid);
    expect(() => readHelpContent(articlesDir({ "fr/page-applications.md": markdown, "en/page-applications.md": enTwin }))).toThrow(
      new RegExp(`fr/page-applications\\.md: ${problem.source}`),
    );
  });

  it("fails when the twins' kind or route differ", () => {
    const fr = page(valid);
    expect(() => readHelpContent(articlesDir({ "fr/page-applications.md": fr, "en/page-applications.md": page(valid.replace("/candidatures", "/agenda")) }))).toThrow(
      /en\/page-applications\.md: its route \/agenda differs from the French one \(\/candidatures\)/,
    );
    expect(() =>
      readHelpContent(articlesDir({ "fr/page-applications.md": fr, "en/page-applications.md": page(valid.replace("kind: page", "kind: faq").replace("route: /candidatures", "")) })),
    ).toThrow(/en\/page-applications\.md: its kind faq differs from the French one \(page\)/);
  });

  it("fails when two page articles explain the same route", () => {
    const twin = page(valid);
    expect(() =>
      readHelpContent(articlesDir({ "fr/page-a.md": twin, "en/page-a.md": twin, "fr/page-b.md": twin, "en/page-b.md": twin })),
    ).toThrow(/fr\/page-b\.md: page-a already explains \/candidatures/);
  });
});

describe("this package's Help Articles", () => {
  it("are all written in French and English, with valid front matter (a missing translation fails npm test)", () => {
    expect(() => readHelpContent()).not.toThrow();
  });

  it("are the ones the app bundles: articles.generated.ts is rebuilt from them (npm run build -w @jobhub/help)", () => {
    expect(readFileSync(generatedModulePath, "utf8")).toBe(renderArticlesModule(readHelpContent()));
  });
});
