import type { SearchCriteria } from "@jobhub/shared";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFranceTravail, franceTravailFromEnv } from "./index";

// Synthetic: no France Travail access yet (#119). Replace with a captured answer once granted.
const SEARCH_ANSWER = readFileSync(new URL("../fixtures/france-travail/search.synthetic.json", import.meta.url), "utf8");

const NOW = new Date("2026-10-15T12:00:00Z");

const criteria: SearchCriteria = { targetRole: "Directrice administrative et financière", location: "Lyon", contractType: "cdi" };

interface Answer {
  status?: number;
  body?: string;
}

/** France Travail as the adapter sees it: its token endpoint and its search, and the requests made to them. */
function fakeFranceTravail(answers: { token?: Answer | (() => Answer); search?: Answer | (() => Answer) } = {}) {
  const requests: { url: URL; method: string; headers: Headers; body: string }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    requests.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    const pick = (answer: Answer | (() => Answer) | undefined, fallback: Answer) => (typeof answer === "function" ? answer() : answer ?? fallback);
    const answer = url.pathname.endsWith("/access_token")
      ? pick(answers.token, { body: JSON.stringify({ access_token: "token-1", token_type: "Bearer", expires_in: 1499 }) })
      : pick(answers.search, { status: 206, body: SEARCH_ANSWER });
    if (answer.status === 0) throw new TypeError("fetch failed");
    return new Response(answer.status === 204 ? null : (answer.body ?? ""), { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
  };
  const searches = () => requests.filter((request) => request.url.pathname.endsWith("/offres/search"));
  const tokens = () => requests.filter((request) => request.url.pathname.endsWith("/access_token"));
  const first = (made: typeof requests) => {
    const [request] = made;
    if (!request) throw new Error("no such request was made");
    return request;
  };
  /** The first search made, and the parameters it searched with. */
  const search = () => first(searches());
  const token = () => first(tokens());
  return { fetch: fetch as typeof globalThis.fetch, requests, searches, tokens, search, token };
}

function setup(answers?: Parameters<typeof fakeFranceTravail>[0]) {
  const api = fakeFranceTravail(answers);
  const franceTravail = createFranceTravail({ clientId: "client-id", clientSecret: "client-secret", fetch: api.fetch });
  return { api, franceTravail };
}

describe("France Travail search", () => {
  it("asks for a token with the client credentials, then searches with it", async () => {
    const { api, franceTravail } = setup();

    const result = await franceTravail.search(criteria, { max: 30, now: NOW });

    expect(result.calls).toBe(2);
    const token = api.token();
    expect(token.method).toBe("POST");
    expect(token.url.origin).toBe("https://entreprise.francetravail.fr");
    expect(token.url.searchParams.get("realm")).toBe("/partenaire");
    const form = new URLSearchParams(token.body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "client_credentials",
      client_id: "client-id",
      client_secret: "client-secret",
      scope: "api_offresdemploiv2 o2dsoffre",
    });
    const search = api.search();
    expect(search.url.origin + search.url.pathname).toBe("https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search");
    expect(search.headers.get("authorization")).toBe("Bearer token-1");
  });

  it("filters by the title's ROME codes, the area, the contract type and the last 30 days, up to the offers wanted", async () => {
    const { api, franceTravail } = setup();

    await franceTravail.search(criteria, { max: 30, now: NOW });

    expect(Object.fromEntries(api.search().url.searchParams)).toEqual({
      codeROME: "M1205",
      departement: "69",
      typeContrat: "CDI",
      minCreationDate: "2026-09-15T12:00:00Z",
      maxCreationDate: "2026-10-15T12:00:00Z",
      range: "0-29",
    });
  });

  it("reads each offer as a posting at its France Travail page, dated by its creation, leaving out one without a title", async () => {
    const { franceTravail } = setup();

    const result = await franceTravail.search(criteria, { max: 30, now: NOW });

    expect(result).toEqual({
      ok: true,
      calls: 2,
      offers: [
        {
          url: "https://candidat.francetravail.fr/offres/recherche/detail/201ABCD",
          details: {
            title: "Directeur administratif et financier H/F",
            content:
              "Rattaché au Directeur Général, vous pilotez la finance, la trésorerie et le contrôle de gestion d'un groupe industriel de 400 personnes.",
            employer: "INDUSTRIES DU RHONE",
            location: "69 - LYON 03",
            contractType: "cdi",
            salary: { min: 110_000, max: 130_000 },
            skills: ["Piloter la trésorerie", "Consolidation des comptes"],
            requiredExperienceYears: 10,
            postedAt: new Date("2026-10-10T09:12:00.000Z"),
          },
        },
        {
          url: "https://candidat.francetravail.fr/offres/recherche/detail/201EFGH",
          details: {
            title: "Responsable administratif et financier (H/F)",
            content: "Mission de remplacement de 9 mois au sein d'une PME de négoce.",
            location: "69 - VILLEURBANNE",
            contractType: "cdd",
            salary: { min: 60_000 },
            postedAt: new Date("2026-10-01T08:00:00.000Z"),
          },
        },
      ],
    });
  });
  it("searches by the title's keywords when it names no ROME job, and all of France for a place it does not know", async () => {
    const { api, franceTravail } = setup();

    await franceTravail.search({ targetRole: "Chef de projet tisserand (H/F)", location: "Télétravail" }, { max: 10, now: NOW });

    const params = api.search().url.searchParams;
    expect(params.get("motsCles")).toBe("chef,projet,tisserand");
    expect(params.has("codeROME")).toBe(false);
    expect(params.has("departement") || params.has("region") || params.has("typeContrat")).toBe(false);
    expect(params.get("range")).toBe("0-9");
  });

  it.each([
    ["Paris", { departement: "75" }],
    ["Écully (69)", { departement: "69" }],
    ["69130 Écully", { departement: "69" }],
    ["Saint-Denis 97400", { departement: "974" }],
    ["Île-de-France", { region: "11" }],
    ["Auvergne-Rhône-Alpes", { region: "84" }],
  ])("filters %s by its area", async (location, filter) => {
    const { api, franceTravail } = setup();

    await franceTravail.search({ ...criteria, location }, { max: 30, now: NOW });

    const params = api.search().url.searchParams;
    expect({ departement: params.get("departement") ?? undefined, region: params.get("region") ?? undefined }).toEqual({ departement: undefined, region: undefined, ...filter });
  });

  it.each([
    ["cdd", "CDD"],
    ["interim", "MIS"],
    ["freelance", "LIB"],
  ] as const)("filters the %s contract type as %s", async (contractType, code) => {
    const { api, franceTravail } = setup();

    await franceTravail.search({ ...criteria, contractType }, { max: 30, now: NOW });

    expect(api.search().url.searchParams.get("typeContrat")).toBe(code);
  });

  it("asks for no more than 150 offers, the most one answer gives", async () => {
    const { api, franceTravail } = setup();

    await franceTravail.search(criteria, { max: 500, now: NOW });

    expect(api.search().url.searchParams.get("range")).toBe("0-149");
  });

  it("keeps its token for later searches until a minute before it expires", async () => {
    const { api, franceTravail } = setup();

    const first = await franceTravail.search(criteria, { max: 30, now: NOW });
    const second = await franceTravail.search(criteria, { max: 30, now: new Date(NOW.getTime() + 1_000_000) });
    const third = await franceTravail.search(criteria, { max: 30, now: new Date(NOW.getTime() + 1_440_000) });

    expect([first.calls, second.calls, third.calls]).toEqual([2, 1, 2]);
    expect(api.tokens()).toHaveLength(2);
  });

  it("gives no offer when France Travail has none", async () => {
    const { franceTravail } = setup({ search: { status: 204 } });

    expect(await franceTravail.search(criteria, { max: 30, now: NOW })).toEqual({ ok: true, offers: [], calls: 2 });
  });

  describe("failing soft: a search never throws, so Job discovery goes on without France Travail", () => {
    it.each([401, 403, 404, 410])("is refused when the search answers %i (access withdrawn or not granted)", async (status) => {
      const { franceTravail } = setup({ search: { status, body: "{}" } });

      expect(await franceTravail.search(criteria, { max: 30, now: NOW })).toEqual({
        ok: false,
        reason: "refused",
        detail: `search refused (${status})`,
        calls: 2,
      });
    });

    it("is refused when the token endpoint turns the credentials down, without searching", async () => {
      const { api, franceTravail } = setup({ token: { status: 401, body: '{"error":"invalid_client"}' } });

      expect(await franceTravail.search(criteria, { max: 30, now: NOW })).toMatchObject({ ok: false, reason: "refused", calls: 1 });
      expect(api.searches()).toHaveLength(0);
    });

    it("asks for a new token after the search refused the one it kept", async () => {
      let status = 401;
      const { api, franceTravail } = setup({ search: () => ({ status, body: status === 200 ? SEARCH_ANSWER : "{}" }) });

      await franceTravail.search(criteria, { max: 30, now: NOW });
      status = 200;
      const again = await franceTravail.search(criteria, { max: 30, now: NOW });

      expect(again).toMatchObject({ ok: true, calls: 2 });
      expect(api.tokens()).toHaveLength(2);
    });

    it.each([
      ["the search fails", { search: { status: 500 } }, "search answered 500", 2],
      ["France Travail is unreachable", { search: { status: 0 } }, "fetch failed", 2],
      ["the search answer is not JSON", { search: { body: "<html>maintenance</html>" } }, undefined, 2],
      ["the token endpoint fails", { token: { status: 503 } }, "token answered 503", 1],
      ["the token answer has no token", { token: { body: "{}" } }, "token answer without access_token", 1],
    ] as const)("fails when %s", async (_case, answers, detail, calls) => {
      const { franceTravail } = setup(answers);

      const result = await franceTravail.search(criteria, { max: 30, now: NOW });

      expect(result).toMatchObject({ ok: false, reason: "failed", calls });
      if (detail && !result.ok) expect(result.detail).toBe(detail);
    });
  });
});

describe("France Travail from the environment", () => {
  it("is off unless both FRANCE_TRAVAIL_CLIENT_ID and FRANCE_TRAVAIL_CLIENT_SECRET are set", () => {
    expect(franceTravailFromEnv({})).toBeNull();
    expect(franceTravailFromEnv({ FRANCE_TRAVAIL_CLIENT_ID: "id" })).toBeNull();
    expect(franceTravailFromEnv({ FRANCE_TRAVAIL_CLIENT_ID: " ", FRANCE_TRAVAIL_CLIENT_SECRET: "secret" })).toBeNull();
    expect(franceTravailFromEnv({ FRANCE_TRAVAIL_CLIENT_ID: "id", FRANCE_TRAVAIL_CLIENT_SECRET: "secret" })).not.toBeNull();
  });
});
