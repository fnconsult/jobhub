import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatedModulePath, HelpContentError, numberedSteps, readHelpContent, renderArticlesModule } from "./content";

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
audience: candidate
topic: utiliser
title: Comment relancer un recruteur ?
synonyms: [relance, rappeler, "sans réponse"]
---
Votre coach propose un e-mail de **relance**.

Jobbbox n'envoie rien à votre place.
`;
const relanceEn = `---
kind: faq
audience: candidate
topic: utiliser
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
        audience: "candidate",
        topic: "utiliser",
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
  const valid = "kind: page\naudience: candidate\ntopic: utiliser\ntitle: Mes candidatures\nsynonyms: [suivi]\nroute: /candidatures";
  const tutorial = (body: string) => page("kind: tutorial\naudience: candidate\ntopic: extension\ntitle: Enregistrer une offre\nsynonyms: [offre]", body);

  it.each([
    ["an unknown kind", page(valid.replace("kind: page", "kind: howto")), /kind must be page, glossary, faq or tutorial/],
    ["no audience", page(valid.replace("audience: candidate\n", "")), /audience is missing: one of visitor, guest, candidate, human-coach or administrator/],
    ["an unknown audience", page(valid.replace("audience: candidate", "audience: recruiter")), /audience must be visitor, guest, candidate, human-coach or administrator/],
    ["no topic", page(valid.replace("topic: utiliser\n", "")), /topic is missing/],
    ["a public article outside the four topics", page(valid.replace("topic: utiliser", "topic: parametres")), /topic must be decouvrir, extension, utiliser or espace-coach/],
    ["an administrator article in a public topic", page(valid.replace("audience: candidate", "audience: administrator")), /an administrator article's topic is a Back Office one, never a public topic \(utiliser\)/],
    ["an administrator topic that is no slug", page(valid.replace("audience: candidate", "audience: administrator").replace("topic: utiliser", "topic: Mes Réglages")), /topic must be a slug/],
    ["a tutorial without numbered steps", tutorial("Ouvrez l'offre, puis cliquez sur « Analyser cette offre »."), /a tutorial needs at least two numbered steps/],
    ["a tutorial with one numbered step", tutorial("1. Ouvrez l'offre.\n\nPuis cliquez sur « Analyser cette offre »."), /a tutorial needs at least two numbered steps/],
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

  it("reads a tutorial of two numbered steps or more, and an administrator article in a Back Office topic", () => {
    const steps = "1. Ouvrez l'offre.\n2. Cliquez sur « Analyser cette offre ».";
    const admin = page("kind: faq\naudience: administrator\ntopic: parametres\ntitle: Les réglages\nsynonyms: [réglage]", "Ils changent sans redéploiement.");
    const content = readHelpContent(articlesDir({ "fr/tutorial-x.md": tutorial(steps), "en/tutorial-x.md": tutorial(steps), "fr/faq-admin.md": admin, "en/faq-admin.md": admin }));
    expect(content.fr.map((entry) => [entry.id, entry.kind, entry.audience, entry.topic])).toEqual([
      ["faq-admin", "faq", "administrator", "parametres"],
      ["tutorial-x", "tutorial", "candidate", "extension"],
    ]);
  });

  it("fails when the twins' audience or topic differ", () => {
    const fr = page(valid);
    expect(() => readHelpContent(articlesDir({ "fr/page-applications.md": fr, "en/page-applications.md": page(valid.replace("audience: candidate", "audience: visitor")) }))).toThrow(
      /en\/page-applications\.md: its audience visitor differs from the French one \(candidate\)/,
    );
    expect(() => readHelpContent(articlesDir({ "fr/page-applications.md": fr, "en/page-applications.md": page(valid.replace("topic: utiliser", "topic: decouvrir")) }))).toThrow(
      /en\/page-applications\.md: its topic decouvrir differs from the French one \(utiliser\)/,
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

describe("numberedSteps — a tutorial's steps", () => {
  it("counts the lines « 1. », « 2. »… that follow each other from 1", () => {
    expect(numberedSteps("1. Ouvrez.\n2. Cliquez.\n3. Choisissez.")).toBe(3);
    expect(numberedSteps("Avant.\n\n1. Ouvrez.\n\nUne remarque.\n\n2. Cliquez.")).toBe(2);
    expect(numberedSteps("2. Cliquez.\n3. Choisissez.")).toBe(0);
    expect(numberedSteps("1. Ouvrez.\n3. Choisissez.")).toBe(1);
    expect(numberedSteps("En 2026. Rien.")).toBe(0);
  });
});
