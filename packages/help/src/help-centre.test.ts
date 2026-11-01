import { describe, expect, it } from "vitest";
import { articles, helpCentreArticle, helpCentrePaths, helpCentreTopics, isPublic, relatedArticles, search } from "./index";
import { PUBLIC_HELP_TOPICS, type HelpArticle } from "./types";

// Issue #549 (ADR-0065): the public Help Centre's topics, articles, search and addresses, and the Coach Panel's scope.
// An Administrator's article is never public: a test article of that audience is looked for everywhere.

const entry = (fields: Partial<HelpArticle> & Pick<HelpArticle, "id" | "title">): HelpArticle => ({
  locale: "fr",
  kind: "faq",
  audience: "candidate",
  topic: "utiliser",
  synonyms: [],
  route: null,
  body: "Un texte.",
  ...fields,
});

const ADMIN = entry({ id: "faq-admin-reglages", title: "Changer les réglages de la plateforme", audience: "administrator", topic: "parametres", synonyms: ["réglages", "plateforme"] });
const FIXTURE: HelpArticle[] = [
  entry({ id: "faq-reglages", title: "Où changer mes réglages ?", synonyms: ["réglages"] }),
  entry({ id: "tutorial-extension", kind: "tutorial", title: "Enregistrer une offre avec l'extension", topic: "extension", synonyms: ["extension", "offre"], body: "1. Ouvrez.\n2. Cliquez." }),
  entry({ id: "faq-where", title: "Où trouver l'aide ?", audience: "visitor", topic: "decouvrir", synonyms: ["aide", "réglages"] }),
  entry({ id: "faq-coach", title: "Préparer une séance", audience: "human-coach", topic: "espace-coach", synonyms: ["séance"] }),
  ADMIN,
];

describe("helpCentreTopics — /aide's four topics", () => {
  it("lists the four public topics in their order, each with its public articles, an Administrator's never", () => {
    const topics = helpCentreTopics("fr", FIXTURE);
    expect(topics.map((topic) => topic.topic)).toEqual(["decouvrir", "extension", "utiliser", "espace-coach"]);
    expect(topics.map((topic) => topic.articles.map((found) => found.id))).toEqual([["faq-where"], ["tutorial-extension"], ["faq-reglages"], ["faq-coach"]]);
    expect(topics.flatMap((topic) => topic.articles)).not.toContain(ADMIN);
  });

  it("keeps an empty topic, with no articles: it says « Bientôt des articles ici », never a 404", () => {
    expect(helpCentreTopics("fr", [FIXTURE[0]!]).map((topic) => topic.articles.length)).toEqual([0, 0, 1, 0]);
  });
});

describe("helpCentreArticle — the article /aide/<topic>/<article> serves", () => {
  it("finds a public article in its own topic only", () => {
    expect(helpCentreArticle("extension", "tutorial-extension", "fr", FIXTURE)?.title).toBe("Enregistrer une offre avec l'extension");
    expect(helpCentreArticle("utiliser", "tutorial-extension", "fr", FIXTURE)).toBeNull();
    expect(helpCentreArticle("inconnue", "tutorial-extension", "fr", FIXTURE)).toBeNull();
  });

  it("never serves an Administrator's article, whatever topic its address names", () => {
    expect(isPublic(ADMIN)).toBe(false);
    for (const topic of [...PUBLIC_HELP_TOPICS, "parametres"]) expect(helpCentreArticle(topic, ADMIN.id, "fr", FIXTURE)).toBeNull();
  });
});

describe("helpCentrePaths — what sitemap.xml lists of the help", () => {
  it("lists /aide, each topic and each public article, in French then under /en, never an Administrator's", () => {
    const paths = helpCentrePaths({ fr: FIXTURE, en: FIXTURE.map((found) => ({ ...found, locale: "en" })) });
    expect(paths).toContain("/aide");
    expect(paths).toContain("/aide/espace-coach");
    expect(paths).toContain("/aide/extension/tutorial-extension");
    expect(paths).toContain("/en/aide/extension/tutorial-extension");
    expect(paths.filter((path) => path.includes(ADMIN.id) || path.includes(ADMIN.topic))).toEqual([]);
  });

  it("lists every public article this build carries, in both languages", () => {
    const paths = helpCentrePaths();
    for (const found of articles("fr").filter(isPublic)) {
      expect(paths).toContain(`/aide/${found.topic}/${found.id}`);
      expect(paths).toContain(`/en/aide/${found.topic}/${found.id}`);
    }
  });
});

describe("search — its scopes", () => {
  it("public: every article but an Administrator's", () => {
    const found = search("réglages plateforme", "fr", { from: FIXTURE, limit: 10 }).map((article) => article.id);
    expect(found).toContain("faq-reglages");
    expect(found).not.toContain(ADMIN.id);
  });

  it("coachPanel: the Candidate's articles and the « extension » topic's, never a Visitor's, a Human Coach's or an Administrator's", () => {
    const ids = (query: string) => search(query, "fr", { from: FIXTURE, scope: "coachPanel", limit: 10 }).map((article) => article.id);
    expect(ids("réglages")).toEqual(["faq-reglages"]);
    expect(ids("extension offre")).toEqual(["tutorial-extension"]);
    expect(ids("séance")).toEqual([]);
  });

  it("finds, in the Coach Panel, this build's tutorial of the « extension » topic, in French and English", () => {
    expect(search("enregistrer une offre avec l'extension", "fr", { scope: "coachPanel" }).map((article) => article.id)).toContain("tutorial-extension-save-job-offer");
    expect(search("save a job offer with the extension", "en", { scope: "coachPanel" }).map((article) => article.id)).toContain("tutorial-extension-save-job-offer");
  });
});

describe("relatedArticles — under an article's page", () => {
  it("gives public articles only, never the article itself, 3 at most", () => {
    const related = relatedArticles(FIXTURE[0]!, { from: FIXTURE });
    expect(related.map((article) => article.id)).toContain("faq-where");
    expect(related).not.toContain(FIXTURE[0]);
    expect(related).not.toContain(ADMIN);
    expect(relatedArticles(articles("fr")[0]!).length).toBeLessThanOrEqual(3);
  });
});

describe("this build's Help Articles (#549)", () => {
  it("each declares its audience and topic, the same in French and English; the former Candidate articles stay `candidate`", () => {
    const english = new Map(articles("en").map((found) => [found.id, found]));
    for (const found of articles("fr")) {
      expect([found.id, english.get(found.id)?.audience, english.get(found.id)?.topic]).toEqual([found.id, found.audience, found.topic]);
      if (/^(page|glossary)-/.test(found.id)) expect([found.id, found.audience]).toEqual([found.id, "candidate"]);
    }
  });

  it("has tutorials in French and English, each of two numbered steps or more", () => {
    for (const locale of ["fr", "en"] as const) {
      const tutorials = articles(locale).filter((found) => found.kind === "tutorial");
      expect(tutorials.map((found) => found.id)).toContain("tutorial-extension-save-job-offer");
      for (const found of tutorials) expect(found.body).toMatch(/^1\. .+\n2\. /m);
    }
  });

  it("answers « Où trouver l'aide de Jobbbox ? » for a Visitor, in the « decouvrir » topic", () => {
    const found = helpCentreArticle("decouvrir", "faq-where-to-find-help", "fr");
    expect([found?.title, found?.audience]).toEqual(["Où trouver l'aide de Jobbbox ?", "visitor"]);
  });
});
