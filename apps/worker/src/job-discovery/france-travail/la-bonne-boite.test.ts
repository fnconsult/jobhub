import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFranceTravailApis, readCompanies } from "./la-bonne-boite";

// Synthetic, shaped as La Bonne Boite's OpenAPI describes `/recherche` (docs/research/france-travail-apis.md §3.4).
const ANSWER = readFileSync(new URL("../fixtures/france-travail/la-bonne-boite-recherche.synthetic.json", import.meta.url), "utf8");
const NOW = new Date("2026-10-26T08:00:00Z");

interface Answer {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

/** Time that passes only when the client waits. */
function fakeClock() {
  let time = NOW.getTime();
  const waits: number[] = [];
  return {
    waits,
    now: () => time,
    sleep: async (ms: number) => {
      waits.push(ms);
      time += ms;
    },
  };
}

/** France Travail's token endpoint, La Bonne Boite and ROMEO, answering in turn what each list holds (the last one again once spent). */
function fakeFranceTravail(answers: { token?: Answer[]; recherche?: Answer[]; romeo?: Answer[] } = {}, clock = fakeClock()) {
  const requests: { url: URL; method: string; headers: Headers; body: string; at: number }[] = [];
  const served = { token: 0, recherche: 0, romeo: 0 };
  const next = (kind: keyof typeof served, fallback: Answer) => {
    const list = answers[kind] ?? [fallback];
    return list[Math.min(served[kind]++, list.length - 1)]!;
  };
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    requests.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: String(init?.body ?? ""), at: clock.now() });
    const answer = url.pathname.endsWith("/access_token")
      ? next("token", { body: JSON.stringify({ access_token: "token-1", expires_in: 1499 }) })
      : url.pathname.endsWith("/predictionMetiers")
        ? next("romeo", { body: "[]" })
        : next("recherche", { body: ANSWER });
    if (answer.status === 0) throw new TypeError("fetch failed");
    return new Response(answer.body ?? "", { status: answer.status ?? 200, headers: { "content-type": "application/json", ...answer.headers } });
  };
  const of = (path: string) => requests.filter((request) => request.url.pathname.endsWith(path));
  return { fetch: fetch as typeof globalThis.fetch, requests, searches: () => of("/recherche"), predictions: () => of("/predictionMetiers"), tokens: () => of("/access_token"), clock };
}

function setup(answers?: Parameters<typeof fakeFranceTravail>[0]) {
  const clock = fakeClock();
  const api = fakeFranceTravail(answers, clock);
  const apis = createFranceTravailApis({ clientId: "client-id", clientSecret: "client-secret", fetch: api.fetch, clock });
  return { api, clock, ...apis };
}

const AROUND_LYON = { citycode: "69123", distanceKm: 30 };

describe("readCompanies: a company's headcount band (#409)", () => {
  const item = (headcount: Record<string, unknown>) => ({ items: [{ siret: "55210055400013", company_name: "ACME", hiring_potential: 50, ...headcount }] });

  it("reads it from figures or text, open-ended without a maximum, and leaves out one that does not read", () => {
    expect(readCompanies(item({ headcount_min: 10000, headcount_max: null }))[0]!.headcount).toEqual({ min: 10000 });
    expect(readCompanies(item({ headcount_min: "20", headcount_max: "49" }))[0]!.headcount).toEqual({ min: 20, max: 49 });
    expect(readCompanies(item({ headcount_min: "beaucoup", headcount_max: "49" }))[0]!.headcount).toBeUndefined();
    expect(readCompanies(item({ headcount_min: "50", headcount_max: "10" }))[0]!.headcount).toEqual({ min: 50 });
    expect(readCompanies(item({}))[0]!.headcount).toBeUndefined();
  });
});

describe("La Bonne Boite (#406)", () => {
  it("asks its own token, then searches by ROME codes around a commune, and reads the companies best hiring first", async () => {
    const { api, laBonneBoite } = setup();

    const result = await laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW);

    expect(result).toEqual({
      ok: true,
      calls: 2,
      companies: [
        { siret: "55210055400013", name: "ACME INDUSTRIE", hiringScore: 82.5, city: "Lyon", activity: "Fabrication d'autres machines d'usage général", headcount: { min: 250, max: 499 } },
        { siret: "38012986600025", name: "BETA LOGISTIQUE", hiringScore: 64, city: "Vénissieux", activity: "Entreposage et stockage non frigorifique", headcount: { min: 50, max: 99 } },
      ],
    });
    expect(new URLSearchParams(api.tokens()[0]!.body).get("scope")).toBe("api_labonneboitev2 search office");
    const [search] = api.searches();
    expect(search!.url.origin + search!.url.pathname).toBe("https://api.francetravail.io/partenaire/labonneboite/v2/recherche");
    expect(search!.headers.get("authorization")).toBe("Bearer token-1");
    // Only the job and the area (ADR-0007).
    expect(Object.fromEntries(search!.url.searchParams)).toEqual({ rome: "M1205", citycode: "69123", distance: "30", page_size: "20" });
  });

  it("sends a free-text job, or a place it could not locate, as they are", async () => {
    const { api, laBonneBoite } = setup();

    await laBonneBoite.search({ job: { by: "job", job: "Chef de projet tisserand" }, area: { location: "Rhône" } }, NOW);

    expect(Object.fromEntries(api.searches()[0]!.url.searchParams)).toEqual({ job: "Chef de projet tisserand", location: "Rhône", page_size: "20" });
  });

  it("makes at most 2 calls a second", async () => {
    const { api, laBonneBoite } = setup();

    for (let i = 0; i < 3; i++) await laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW);

    const at = api.searches().map((search) => search.at);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(500);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(500);
  });

  it("waits a second when its X-Ratelimit headers say none is left", async () => {
    const { api, laBonneBoite } = setup({
      recherche: [{ body: ANSWER, headers: { "x-ratelimit-burst-capacity-clientidlimiter": "2", "x-ratelimit-remaining-clientidlimiter": "0" } }, { body: ANSWER }],
    });

    await laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW);
    await laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW);

    const [first, second] = api.searches();
    expect(second!.at - first!.at).toBeGreaterThanOrEqual(1000);
  });

  it("waits out a 429's Retry-After and asks once more", async () => {
    const { api, clock, laBonneBoite } = setup({ recherche: [{ status: 429, headers: { "retry-after": "3" } }, { body: ANSWER }] });

    const result = await laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW);

    expect(result).toMatchObject({ ok: true, calls: 3 });
    expect(clock.waits).toContain(3000);
    expect(api.searches()).toHaveLength(2);
  });

  it("fails when still rate limited after waiting, without asking again", async () => {
    const { api, laBonneBoite } = setup({ recherche: [{ status: 429, headers: { "retry-after": "1" } }] });

    expect(await laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW)).toEqual({
      ok: false,
      reason: "failed",
      detail: "La Bonne Boite answered 429",
      calls: 3,
    });
    expect(api.searches()).toHaveLength(2);
  });

  it("is refused when France Travail turns its token or its search down, and fails on anything else", async () => {
    const tokenRefused = setup({ token: [{ status: 400, body: JSON.stringify({ error: "invalid_scope" }) }] });
    expect(await tokenRefused.laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW)).toMatchObject({ ok: false, reason: "refused" });

    const searchRefused = setup({ recherche: [{ status: 403, body: JSON.stringify({ error: "forbidden" }) }] });
    expect(await searchRefused.laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW)).toMatchObject({ ok: false, reason: "refused" });

    const down = setup({ recherche: [{ status: 503 }] });
    expect(await down.laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW)).toMatchObject({ ok: false, reason: "failed", detail: "La Bonne Boite answered 503" });

    const unreachable = setup({ recherche: [{ status: 0 }] });
    expect(await unreachable.laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW)).toMatchObject({ ok: false, reason: "failed" });
  });

  it("asks a new token after La Bonne Boite turned one down (401)", async () => {
    const { api, laBonneBoite } = setup({ recherche: [{ status: 401 }, { body: ANSWER }] });

    expect(await laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW)).toMatchObject({ ok: false, reason: "refused" });
    expect(await laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: AROUND_LYON }, NOW)).toMatchObject({ ok: true });
    expect(api.tokens()).toHaveLength(2);
  });
});

describe("ROMEO's job prediction (#406)", () => {
  const prediction = (metiers: { codeRome: string; scorePrediction: number }[]) =>
    JSON.stringify([{ intitule: "Responsable bureau d'études", identifiant: "1", uuidInference: "u-1", metiersRome: metiers.map((m) => ({ libelleRome: "…", codeAppellation: "1", libelleAppellation: "…", ...m })) }]);

  it("asks ROMEO with its own token for the title alone, and keeps the codes scored 0.7 or more, best first, each once", async () => {
    const { api, romeo } = setup({
      romeo: [{ body: prediction([{ codeRome: "H1206", scorePrediction: 0.91 }, { codeRome: "H1206", scorePrediction: 0.8 }, { codeRome: "H1102", scorePrediction: 0.75 }, { codeRome: "M1302", scorePrediction: 0.4 }]) }],
    });

    expect(await romeo.predict("Responsable bureau d'études", NOW)).toEqual({ ok: true, codes: ["H1206", "H1102"], calls: 2 });
    expect(new URLSearchParams(api.tokens()[0]!.body).get("scope")).toBe("api_romeov2");
    const [asked] = api.predictions();
    expect(asked!.method).toBe("POST");
    expect(asked!.url.href).toBe("https://api.francetravail.io/partenaire/romeo/v2/predictionMetiers");
    expect(JSON.parse(asked!.body)).toEqual({
      appellations: [{ intitule: "Responsable bureau d'études", identifiant: "1" }],
      options: { nomAppelant: "jobbbox", nbResultats: 5, seuilScorePrediction: 0.7 },
    });
  });

  it("answers no code for an answer it cannot read, and is refused like La Bonne Boite", async () => {
    expect(await setup({ romeo: [{ body: "{}" }] }).romeo.predict("Tisserand", NOW)).toEqual({ ok: true, codes: [], calls: 2 });
    expect(await setup({ romeo: [{ status: 403 }] }).romeo.predict("Tisserand", NOW)).toMatchObject({ ok: false, reason: "refused" });
  });

  it("shares La Bonne Boite's pace: both are France Travail's 2 calls a second", async () => {
    const { api, laBonneBoite, romeo } = setup();

    await romeo.predict("Tisserand", NOW);
    await laBonneBoite.search({ job: { by: "job", job: "Tisserand" }, area: AROUND_LYON }, NOW);

    expect(api.searches()[0]!.at - api.predictions()[0]!.at).toBeGreaterThanOrEqual(500);
  });
});
