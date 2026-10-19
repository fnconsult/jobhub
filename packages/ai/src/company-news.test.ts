import { describe, expect, it } from "vitest";
import { createAiLayer } from "./ai-layer";
import { buildCompanyNewsQuery, companyNewsIn, mayNamePerson } from "./company-news";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

const now = new Date("2026-10-19T10:00:00Z");
const companyNames = ["Acme Industrie"];

/** An article as the news search answers it, naming no one unless said otherwise. */
const article = (fields: Record<string, unknown> = {}) => ({
  title: "Acme ouvre une usine à Clermont-Ferrand",
  outlet: "Les Echos",
  date: "2026-09-01",
  url: "https://news.example/usine",
  namesPerson: false,
  ...fields,
});
const answer = (...articles: unknown[]) => JSON.stringify({ articles });
const read = (text: string, options: { sourceDates?: Record<string, Date> } = {}) => companyNewsIn(text, { now, companyNames, ...options });

describe("the Company News search query", () => {
  it("names the employer, its registered name and its website's host, and asks for no person to be named", () => {
    const query = buildCompanyNewsQuery({ employer: "Acme", registeredName: "ACME INDUSTRIE", website: "https://www.acme.example/fr/about" });

    expect(query).toContain("« Acme »");
    expect(query).toContain("raison sociale « ACME INDUSTRIE »");
    expect(query).toContain("site web acme.example");
    expect(query).not.toContain("/fr/about");
    expect(query).toMatch(/12 mois/);
    expect(query).toMatch(/N'inclus aucun article dont le titre nomme une personne/);
  });

  it("strips contact details typed into the employer's name", () => {
    const query = buildCompanyNewsQuery({ employer: "Acme hr@acme.example +33 6 12 34 56 78" });

    expect(query).toContain("« Acme »");
    expect(query).not.toMatch(/hr@|12 34/);
  });

  it("searches the registered name for an employer named by its SIREN alone", () => {
    const query = buildCompanyNewsQuery({ employer: "300349636", registeredName: "SEB SA" });

    expect(query).toContain("l'entreprise « SEB SA »");
    expect(query).not.toContain("«  »");
    expect(query).not.toContain("raison sociale");
  });
});

describe("the Company News kept from the search's answer", () => {
  it("keeps each article's title, outlet, date and link, never its text", () => {
    expect(read(answer(article({ text: "Le texte complet de l'article…", summary: "Résumé" })))).toEqual([
      { title: "Acme ouvre une usine à Clermont-Ferrand", outlet: "Les Echos", publishedAt: "2026-09-01", url: "https://news.example/usine" },
    ]);
  });

  it("keeps only articles of the last twelve months, with a real date", () => {
    const articles = read(
      answer(
        article({ url: "https://news.example/1", date: "2025-10-20" }),
        article({ url: "https://news.example/2", date: "2025-10-18" }),
        article({ url: "https://news.example/3", date: "2026-12-01" }),
        article({ url: "https://news.example/4", date: "2026-02-31" }),
        article({ url: "https://news.example/5", date: "il y a deux jours" }),
        article({ url: "https://news.example/6", date: "2026-10-19T08:00:00Z" }),
      ),
    );

    expect(articles.map(({ url, publishedAt }) => [url, publishedAt])).toEqual([
      ["https://news.example/6", "2026-10-19"],
      ["https://news.example/1", "2025-10-20"],
    ]);
  });

  it("takes the date the search gives the source when the answer gives none", () => {
    const articles = read(answer(article({ date: null })), { sourceDates: { "https://news.example/usine": new Date("2026-08-01T12:00:00Z") } });

    expect(articles).toMatchObject([{ publishedAt: "2026-08-01" }]);
    expect(read(answer(article({ date: undefined })))).toEqual([]);
  });

  it("keeps only http(s) links, never a social network's post", () => {
    const articles = read(
      answer(
        article({ url: "javascript:alert(1)" }),
        article({ url: "news.example/sans-protocole" }),
        article({ url: "https://www.linkedin.com/posts/jean-dupont-123" }),
        article({ url: "https://x.com/acme/status/1" }),
        article({ url: "http://news.example/ok#comments" }),
      ),
    );

    expect(articles.map(({ url }) => url)).toEqual(["http://news.example/ok"]);
  });

  it("needs a title and an outlet", () => {
    expect(read(answer(article({ title: "" }), article({ outlet: null }), article({ title: 42 }), article({ outlet: "x".repeat(81) })))).toEqual([]);
  });

  it("keeps at most five articles, newest first, each link once", () => {
    const articles = read(
      answer(
        ...["2026-03-01", "2026-09-01", "2026-05-01", "2026-07-01", "2026-01-01", "2026-08-01"].map((date, index) => article({ date, url: `https://news.example/${index}` })),
        article({ date: "2026-10-01", url: "https://news.example/1#again" }),
      ),
    );

    expect(articles.map(({ publishedAt }) => publishedAt)).toEqual(["2026-09-01", "2026-08-01", "2026-07-01", "2026-05-01", "2026-03-01"]);
  });

  it("drops an article the model does not say names no one", () => {
    expect(read(answer(article({ namesPerson: true }), article({ namesPerson: undefined }), article({ namesPerson: "false" })))).toEqual([]);
  });

  it("drops an article whose title may name a person, even when the model says it names no one", () => {
    const titles = [
      "Jean Dupont quitte Acme",
      "Acme : le PDG annonce un plan social",
      "Mme Durand nommée à la tête d'Acme",
      "Acme names Peter Smith as chief financial officer",
      "Acme recrute Pauline Martin pour sa filiale",
      "Acme Hires New Head Of Sales In Berlin",
      "Le fondateur d'Acme se confie",
    ];

    expect(read(answer(...titles.map((title, index) => article({ title, url: `https://news.example/${index}` }))))).toEqual([]);
  });

  it("drops an article whose outlet is a person's", () => {
    expect(read(answer(article({ outlet: "Le blog de Jean Martin" })))).toEqual([]);
  });

  it("keeps titles whose capitalised words are the employer's, a place, or an English headline's", () => {
    const titles = ["Acme Industrie ouvre une usine à Clermont-Ferrand", "Acme Industrie Opens A New Plant Near Lyon", "Résultats : Acme Industrie en hausse de 12 %"];

    expect(read(answer(...titles.map((title, index) => article({ title, url: `https://news.example/${index}` })))).map(({ title }) => title)).toEqual(titles);
  });

  it("shows the outlet apart from a title that ends with it", () => {
    expect(read(answer(article({ title: "Acme ouvre une usine - Les Echos" })))).toMatchObject([{ title: "Acme ouvre une usine", outlet: "Les Echos" }]);
  });

  it("gives no article for an answer that is not readable", () => {
    expect(read("Je n'ai trouvé aucun article.")).toEqual([]);
    expect(read('{"articles": "aucun"}')).toEqual([]);
    expect(read("{not json")).toEqual([]);
  });
});

describe("mayNamePerson", () => {
  it("takes two capitalised words, past a sentence-case title's first, not the employer's, for a name: when in doubt, one", () => {
    expect(mayNamePerson("Acme rachète Globex Robotics", companyNames)).toBe(true);
    expect(mayNamePerson("Acme rachète un concurrent allemand", companyNames)).toBe(false);
    expect(mayNamePerson("The New York Times", companyNames, { name: true })).toBe(false);
  });
});

describe("the AI layer's Company News search", () => {
  const recent = new Date("2026-10-19T10:00:00Z");

  it("sends the news query with a twelve-month window, logs its usage, and keeps the articles", async () => {
    const perplexity = createFakeProvider({ id: "perplexity", residency: "outside_eu", answer: answer(article()), sources: ["https://news.example/usine"] });
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [perplexity], routes: { web_search: "perplexity" }, usage, now: () => recent });

    const news = await ai.searchCompanyNews({ candidateId: "cand-1", employer: "Acme Industrie", registeredName: "ACME INDUSTRIE" });

    expect(news).toEqual([{ title: "Acme ouvre une usine à Clermont-Ferrand", outlet: "Les Echos", publishedAt: "2026-09-01", url: "https://news.example/usine" }]);
    expect(perplexity.searches).toEqual([expect.objectContaining({ filters: { maxAgeDays: 365 } })]);
    expect(perplexity.queries[0]).toContain("Articles de presse");
    expect(usage.entries).toEqual([expect.objectContaining({ candidateId: "cand-1", task: "web_search", provider: "perplexity", ok: true })]);
  });

  it("never fails: a failed search gives no article, and is logged as failed", async () => {
    const failing = { ...createFakeProvider({ id: "perplexity", residency: "outside_eu" }), search: async () => Promise.reject(new Error("HTTP 429")) };
    const usage = createMemoryUsageLog();
    const warnings: string[] = [];
    const ai = createAiLayer({ providers: [failing], routes: { web_search: "perplexity" }, usage, warn: (message) => warnings.push(message) });

    expect(await ai.searchCompanyNews({ candidateId: "cand-1", employer: "Acme" })).toEqual([]);
    expect(usage.entries).toEqual([expect.objectContaining({ task: "web_search", ok: false })]);
    expect(warnings).toEqual([expect.stringMatching(/Company News unavailable/)]);
  });

  it("never fails without a web-search provider either", async () => {
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral" })], routes: {}, usage: createMemoryUsageLog(), warn: () => {} });

    expect(await ai.searchCompanyNews({ candidateId: null, employer: "Acme" })).toEqual([]);
  });
});
