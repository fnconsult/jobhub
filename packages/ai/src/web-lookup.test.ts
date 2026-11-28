/**
 * The AI Coach's Web lookup (ADR-0119 « A web lookup », #1159): a query the AI Coach words, sent to the active Search
 * provider and its fallback, never one naming a person nor aimed at LinkedIn; the pages it finds, none on LinkedIn nor
 * naming a person.
 */
import { describe, expect, it } from "vitest";
import { createAiLayer } from "./ai-layer";
import { DataResidencyError } from "./errors";
import { createFakeProvider, createMemoryUsageLog } from "./testing";
import { WEB_LOOKUP_MAX_RESULTS, webLookupRefusal, webPagesIn } from "./web-lookup";

describe("a Web lookup's query", () => {
  it("about a company, its market or a salary, is sent", () => {
    for (const query of [
      "qui sont les concurrents d'Exemple Industrie",
      "Exemple Industrie levée de fonds 2026",
      "salaire médian directeur administratif et financier Lyon",
      "culture d'entreprise Société Fictive avis",
      "Data Analyst salary Paris 2026",
    ]) {
      expect(webLookupRefusal(query), query).toBeNull();
    }
  });

  it("naming a person is refused: a first name of the register before a capitalised word, or an honorific (ADR-0007)", () => {
    for (const query of ["Jean Dupont Exemple Industrie", "parcours de Claire Martin, directrice chez Exemple Conseil", "Mme Durand Société Fictive", "M. Martin DRH"]) {
      expect(webLookupRefusal(query), query).toBe("names_person");
    }
  });

  it("aimed at LinkedIn is refused, whatever its spelling", () => {
    for (const query of ["Exemple Industrie site:linkedin.com", "page LinkedIn d'Exemple Industrie", "Exemple Industrie linked in", "lnkd.in Exemple"]) {
      expect(webLookupRefusal(query), query).toBe("linkedin");
    }
  });

  it("with no words is refused", () => {
    expect(webLookupRefusal("   ")).toBe("empty");
    expect(webLookupRefusal("a@b.example +33 6 12 34 56 78")).toBe("empty");
  });
});

describe("a Web lookup's pages", () => {
  const answer = [
    "Exemple Industrie et ses concurrents\nhttps://news.example/exemple-industrie-concurrents\nLe marché compte trois acteurs : Société Fictive, Fictif Industries et Exemple Industrie.",
    "Profil LinkedIn\nhttps://www.linkedin.com/company/exemple-industrie\nExemple Industrie sur LinkedIn",
    "Entretien avec Jean Dupont\nhttps://blog.example/jean-dupont\nLe dirigeant raconte",
    "Marché de l'emballage\nhttps://etudes.example/emballage\nUne étude du marché.\n\nSuite de l'extrait sur deux paragraphes.",
  ].join("\n\n");
  const sources = ["https://news.example/exemple-industrie-concurrents", "https://www.linkedin.com/company/exemple-industrie", "https://blog.example/jean-dupont", "https://etudes.example/emballage"];

  it("are each page's title, link and extract, as the Search provider listed them", () => {
    expect(webPagesIn(answer, sources)).toEqual([
      {
        title: "Exemple Industrie et ses concurrents",
        url: "https://news.example/exemple-industrie-concurrents",
        snippet: "Le marché compte trois acteurs : Société Fictive, Fictif Industries et Exemple Industrie.",
      },
      { title: "Marché de l'emballage", url: "https://etudes.example/emballage", snippet: "Une étude du marché. Suite de l'extrait sur deux paragraphes." },
    ]);
  });

  it("are never on LinkedIn, nor naming a person in their title or extract", () => {
    const urls = webPagesIn(answer, sources).map((page) => page.url);
    expect(urls).not.toContain("https://www.linkedin.com/company/exemple-industrie");
    expect(urls).not.toContain("https://blog.example/jean-dupont");
    expect(webPagesIn("Une étude\nhttps://etudes.example/a\nSelon Claire Martin, le marché croît.", ["https://etudes.example/a"])).toEqual([]);
  });

  it("are at most WEB_LOOKUP_MAX_RESULTS", () => {
    const many = Array.from({ length: 9 }, (_, index) => `https://etudes.example/${index}`);
    expect(webPagesIn(many.map((url, index) => `Étude ${index}\n${url}\nUn extrait.`).join("\n\n"), many)).toHaveLength(WEB_LOOKUP_MAX_RESULTS);
  });
});

describe("the AI layer's lookUpWeb", () => {
  const pages = "Exemple Industrie et ses concurrents\nhttps://news.example/a\nTrois acteurs.";
  const layer = () => {
    const provider = createFakeProvider({ id: "perplexity", residency: "outside_eu", answer: pages, sources: ["https://news.example/a"] });
    const usage = createMemoryUsageLog();
    return { provider, usage, ai: createAiLayer({ providers: [provider], routes: { web_search: "perplexity" }, usage, warn: () => {} }) };
  };

  it("sends the query alone to the active Search provider, LinkedIn excluded, and records it on the web_search task", async () => {
    const { ai, provider, usage } = layer();
    const found = await ai.lookUpWeb({ candidateId: "cand-1", query: "qui sont les concurrents d'Exemple Industrie" });

    expect(provider.queries).toEqual(["qui sont les concurrents d'Exemple Industrie"]);
    expect(provider.searches[0]?.filters).toEqual({ excludeDomains: ["linkedin.com"], maxResults: WEB_LOOKUP_MAX_RESULTS });
    expect(found.pages).toEqual([{ title: "Exemple Industrie et ses concurrents", url: "https://news.example/a", snippet: "Trois acteurs." }]);
    expect(found.call.provider).toBe("perplexity");
    expect(usage.entries.map((entry) => [entry.task, entry.candidateId, entry.outcome])).toEqual([["web_search", "cand-1", "ok"]]);
  });

  it("never sends a query naming a person or aimed at LinkedIn: refused, recorded as not sent", async () => {
    const { ai, provider, usage } = layer();
    await expect(ai.lookUpWeb({ candidateId: "cand-1", query: "Jean Dupont Exemple Industrie" })).rejects.toBeInstanceOf(DataResidencyError);
    await expect(ai.lookUpWeb({ candidateId: "cand-1", query: "Exemple Industrie site:linkedin.com" })).rejects.toBeInstanceOf(DataResidencyError);
    expect(provider.queries).toEqual([]);
    expect(usage.entries.map((entry) => [entry.task, entry.sent])).toEqual([
      ["web_search", false],
      ["web_search", false],
    ]);
  });

  it("is refused in an Eval Run, as every web search is", async () => {
    const { ai } = layer();
    await expect(ai.forEval().lookUpWeb({ candidateId: null, query: "Exemple Industrie" })).rejects.toThrow("An Eval Run makes no web search");
  });
});
