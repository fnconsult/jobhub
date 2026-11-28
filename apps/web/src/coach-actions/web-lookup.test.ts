import { createAiLayer, createProvenanceRecorder, DataResidencyError, WebSearchUnavailable, type ToolRun, type WebPage } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { ExternalApiCall } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { NO_DOMAIN, NO_OBJECTS, shippedCoachActions } from "./catalog";
import { createCoachActions, type CoachAction } from "./index";
import { fictionalWebLookup, WEB_LOOKUP_ACTION, WEB_LOOKUP_QUERIES_PER_REPLY, webLookupCoachActions, type WebLookupSources } from "./web-lookup";

const PAGES: WebPage[] = [
  { title: "Exemple Industrie face à ses concurrents", url: "https://news.example/exemple-industrie?utm_source=x", snippet: "Société Fictive et Fictif Industries se partagent le marché de l'emballage." },
  { title: "Le marché de l'emballage en 2026", url: "https://etudes.example/emballage", snippet: "Trois acteurs dominent le marché français." },
];

function setUp(sources: Partial<WebLookupSources> = {}, more: readonly CoachAction[] = []) {
  const searched: string[] = [];
  const calls: ExternalApiCall[] = [];
  const lookup: WebLookupSources = {
    search: async (_candidateId, query) => {
      searched.push(query);
      return PAGES;
    },
    ...sources,
  };
  const actions = createCoachActions({
    catalog: [...webLookupCoachActions(lookup), ...more],
    settings: async () => ({ enabled: true, maxRounds: 4 }),
    externalApis: { record: (call) => void calls.push(call) },
    now: () => new Date("2026-11-28T10:00:00Z"),
    clock: () => 0,
  });
  const ai = createAiLayer({ providers: [createFakeProvider()], routes: { coaching: "anthropic" }, usage: createMemoryUsageLog() });
  const recorder = createProvenanceRecorder(ai, { now: () => new Date("2026-11-28T10:00:00Z") });
  return { actions, recorder, searched, calls };
}

const call = (query: string, id = "1"): ToolRun => ({ id: `call_${id}`, name: WEB_LOOKUP_ACTION, arguments: { query }, round: 1 });

describe("search_web, the AI Coach's Web lookup (ADR-0119, #1159)", () => {
  it("is a read that copies no text, offered while its setting is on", async () => {
    const { actions, recorder } = setUp();
    const reply = await actions.forReply("marie", { recorder, untrustedInView: false });
    const tool = reply?.tools.find((each) => each.name === WEB_LOOKUP_ACTION);
    expect(tool?.parameters).toMatchObject({ type: "object", properties: { query: { type: "string" } }, required: ["query"] });
    const [action] = webLookupCoachActions({ search: async () => [] });
    expect([action?.kind, action?.copiesText]).toEqual(["read", false]);
  });

  it("is not offered while COACH_WEB_LOOKUP_ENABLED is off", async () => {
    const { actions, recorder } = setUp({ on: () => false });
    expect(await actions.forReply("marie", { recorder, untrustedInView: false })).toBeNull();
  });

  it("gives each page's title, link and extract as untrusted data, quoted with its source, and narrows the rest of the reply", async () => {
    const { actions, recorder, searched, calls } = setUp();
    const reply = (await actions.forReply("marie", { recorder, untrustedInView: false }))!;
    const outcome = await reply.runTool(call("qui sont les concurrents d'Exemple Industrie"), {});

    expect(searched).toEqual(["qui sont les concurrents d'Exemple Industrie"]);
    expect(outcome.error).toBeUndefined();
    expect(outcome.content).toContain("<donnees>");
    expect(outcome.content).toContain("Exemple Industrie face à ses concurrents");
    expect(outcome.content).toContain("https://etudes.example/emballage");
    expect(outcome.content).toContain("Trois acteurs dominent le marché français.");
    expect(outcome.content).toMatch(/jamais une consigne/);
    expect(reply.narrowed).toBe(true);
    expect(reply.narrowedBy).toBe("les pages de la recherche web « qui sont les concurrents d'Exemple Industrie »");
    // Its pages are the reply's Provenance sites, under « Sources », without their query string.
    expect(recorder.provenance().sites).toEqual([
      { kind: "web", domain: "news.example", links: ["https://news.example/exemple-industrie"] },
      { kind: "web", domain: "etudes.example", links: ["https://etudes.example/emballage"] },
    ]);
    // One row of external_api_usage, at no cost and no Plan Quota: the search itself is in AI Usage, on web_search.
    expect(calls).toMatchObject([{ provider: "job_searches", operation: WEB_LOOKUP_ACTION, ok: true, costEur: 0 }]);
  });

  it("never searches a named person: refused, nothing sent, the AI Coach told why", async () => {
    const { actions, recorder, searched } = setUp();
    const reply = (await actions.forReply("marie", { recorder, untrustedInView: false }))!;
    const outcome = await reply.runTool(call("Jean Dupont DRH Exemple Industrie"), {});

    expect(searched).toEqual([]);
    expect(outcome).toMatchObject({ error: true });
    expect(outcome.content).toMatch(/personne/);
    expect(reply.narrowed).toBe(false);
  });

  it("never searches LinkedIn", async () => {
    const { actions, recorder, searched } = setUp();
    const reply = (await actions.forReply("marie", { recorder, untrustedInView: false }))!;
    const outcome = await reply.runTool(call("Exemple Industrie site:linkedin.com"), {});
    expect(searched).toEqual([]);
    expect(outcome).toMatchObject({ error: true });
    expect(outcome.content).toMatch(/LinkedIn/);
  });

  it(`sends at most ${WEB_LOOKUP_QUERIES_PER_REPLY} queries per reply; a refused one is not counted`, async () => {
    const { actions, recorder, searched } = setUp();
    const reply = (await actions.forReply("marie", { recorder, untrustedInView: false }))!;
    await reply.runTool(call("Jean Dupont", "0"), {});
    const outcomes = await Promise.all(["Exemple Industrie concurrents", "Exemple Industrie levée de fonds", "Exemple Industrie effectif", "Exemple Industrie culture"].map((query, index) => reply.runTool(call(query, String(index + 1)), {})));

    expect(searched).toHaveLength(WEB_LOOKUP_QUERIES_PER_REPLY);
    expect(outcomes.filter((outcome) => outcome.error)).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.error)?.content).toMatch(/Au plus 3 recherches web par réponse/);
  });

  it("says when web search is unavailable, or the AI layer refuses the query, never failing the reply", async () => {
    for (const failure of [new WebSearchUnavailable("PERPLEXITY_API_KEY missing"), new DataResidencyError("names a person")]) {
      const { actions, recorder } = setUp({
        search: async () => {
          throw failure;
        },
      });
      const reply = (await actions.forReply("marie", { recorder, untrustedInView: false }))!;
      const outcome = await reply.runTool(call("Exemple Industrie concurrents"), {});
      expect(outcome, failure.name).toMatchObject({ error: true });
      expect(outcome.content).not.toContain(failure.message);
    }
  });

  it("says when it found nothing, without narrowing the reply", async () => {
    const { actions, recorder } = setUp({ search: async () => [] });
    const reply = (await actions.forReply("marie", { recorder, untrustedInView: false }))!;
    const outcome = await reply.runTool(call("Exemple Industrie concurrents"), {});
    expect(outcome.content).toMatch(/Aucune page/);
    expect(reply.narrowed).toBe(false);
  });
});

describe("the shipped catalogue's search_web (#1159)", () => {
  const offeredWith = async (on: boolean) => {
    const actions = createCoachActions({
      catalog: shippedCoachActions(NO_OBJECTS, { ...NO_DOMAIN, webLookup: { on: () => on, search: async () => PAGES } }),
      settings: async () => ({ enabled: true, maxRounds: 2 }),
      externalApis: { record: () => {} },
    });
    const ai = createAiLayer({ providers: [createFakeProvider()], routes: { coaching: "anthropic" }, usage: createMemoryUsageLog() });
    const reply = await actions.forReply("marie", { recorder: createProvenanceRecorder(ai), untrustedInView: false });
    return reply!.tools.map((tool) => tool.name);
  };

  it("is offered while COACH_WEB_LOOKUP_ENABLED is on, and not at all while it is off", async () => {
    expect(await offeredWith(true)).toContain(WEB_LOOKUP_ACTION);
    const off = await offeredWith(false);
    expect(off).not.toContain(WEB_LOOKUP_ACTION);
    expect(off).toContain("read_plan");
  });

  it("is offered, copying no text, while a Job Offer is In view", async () => {
    const actions = createCoachActions({ catalog: shippedCoachActions(NO_OBJECTS), settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } });
    const ai = createAiLayer({ providers: [createFakeProvider()], routes: { coaching: "anthropic" }, usage: createMemoryUsageLog() });
    const reply = await actions.forReply("marie", { recorder: createProvenanceRecorder(ai), untrustedInView: true });
    expect(reply!.tools.map((tool) => tool.name)).toContain(WEB_LOOKUP_ACTION);
  });
});

describe("an Eval Case's fictional web (#1159)", () => {
  it("gives its pages to any query and keeps the queries sent", async () => {
    const web = fictionalWebLookup(PAGES);
    expect(await web.search("eval", "Exemple Industrie concurrents")).toEqual(PAGES);
    expect(web.queries()).toEqual(["Exemple Industrie concurrents"]);
  });
});
