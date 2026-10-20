import type { ExternalApiCall } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createGeoApiPlaces } from "./geo-api";

type Answer = Response | Error;

/** A stand-in for geo.api.gouv.fr: each path answered by `answers`, every URL asked kept in `urls`. */
function fakeGeoApi(answers: Partial<Record<"/communes" | "/departements" | "/regions", () => Answer>>) {
  const urls: URL[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(url);
    const answer = answers[url.pathname as keyof typeof answers]?.() ?? Response.json([]);
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

const lyon = { nom: "Lyon", code: "69123", codeDepartement: "69", population: 519127 };
const lyons = { nom: "Lyons-la-Forêt", code: "27377", codeDepartement: "27", population: 700 };
const rhone = { nom: "Rhône", code: "69", codeRegion: "84" };
const ara = { nom: "Auvergne-Rhône-Alpes", code: "84" };

describe("place suggestions from geo.api.gouv.fr", () => {
  it("lists the matching communes with their département's code, then the départements, then the régions", async () => {
    const { fetch } = fakeGeoApi({
      "/communes": () => Response.json([lyon, lyons]),
      "/departements": () => Response.json([rhone]),
      "/regions": () => Response.json([ara]),
    });
    expect(await createGeoApiPlaces({ fetch }).suggest("rhô")).toEqual([
      { name: "Lyon (69)", kind: "commune" },
      { name: "Lyons-la-Forêt (27)", kind: "commune" },
      { name: "Rhône", kind: "departement" },
      { name: "Auvergne-Rhône-Alpes", kind: "region" },
    ]);
  });

  it("asks by name, the most populated communes first, with the query encoded", async () => {
    const { fetch, urls } = fakeGeoApi({});
    await createGeoApiPlaces({ fetch, baseUrl: "https://geo.example" }).suggest("  Rhône ");
    const communes = urls.find((url) => url.pathname === "/communes")!;
    expect(communes.origin).toBe("https://geo.example");
    expect(communes.searchParams.get("nom")).toBe("Rhône");
    expect(communes.searchParams.get("boost")).toBe("population");
    expect(communes.href).toContain("nom=Rh%C3%B4ne");
    expect(urls.map((url) => url.pathname).sort()).toEqual(["/communes", "/departements", "/regions"]);
  });

  it("asks nothing for fewer than three characters", async () => {
    const { fetch, urls } = fakeGeoApi({});
    expect(await createGeoApiPlaces({ fetch }).suggest(" ly ")).toEqual([]);
    expect(urls).toEqual([]);
  });

  it("lists at most eight places, each once, five communes at most leaving room for the départements and régions", async () => {
    const communes = Array.from({ length: 10 }, (_, index) => ({ nom: `Saint-Martin-${index}`, codeDepartement: "01" }));
    const { fetch } = fakeGeoApi({
      "/communes": () => Response.json([communes[0], ...communes]),
      "/departements": () => Response.json([{ nom: "Seine-Saint-Denis" }, { nom: "Seine-Saint-Denis" }]),
      "/regions": () => Response.json([{ nom: "Saint-Région-1" }, { nom: "Saint-Région-2" }, { nom: "Saint-Région-3" }]),
    });
    const places = await createGeoApiPlaces({ fetch }).suggest("saint");
    expect(places.map((place) => place.name)).toEqual([
      "Saint-Martin-0 (01)",
      "Saint-Martin-1 (01)",
      "Saint-Martin-2 (01)",
      "Saint-Martin-3 (01)",
      "Saint-Martin-4 (01)",
      "Seine-Saint-Denis",
      "Saint-Région-1",
      "Saint-Région-2",
    ]);
  });

  it("still lists what the API found when part of it fails, and nothing when all of it does", async () => {
    const partly = fakeGeoApi({ "/communes": () => new Response("busy", { status: 503 }), "/departements": () => new Error("timeout"), "/regions": () => Response.json([ara]) });
    expect(await createGeoApiPlaces({ fetch: partly.fetch }).suggest("auvergne")).toEqual([{ name: "Auvergne-Rhône-Alpes", kind: "region" }]);
    const down = fakeGeoApi({ "/communes": () => new Error("down"), "/departements": () => new Error("down"), "/regions": () => new Response("{oops", { status: 200 }) });
    expect(await createGeoApiPlaces({ fetch: down.fetch }).suggest("auvergne")).toEqual([]);
  });

  it("answers the same query again from its cache for a while, written with any case or accents", async () => {
    const { fetch, urls } = fakeGeoApi({ "/departements": () => Response.json([rhone]) });
    let now = new Date("2026-10-20T10:00:00Z");
    const places = createGeoApiPlaces({ fetch, now: () => now, cacheTtlMs: 600_000 });
    await places.suggest("Rhône");
    expect(await places.suggest("rhone ")).toEqual([{ name: "Rhône", kind: "departement" }]);
    expect(urls).toHaveLength(3);
    now = new Date("2026-10-20T10:11:00Z");
    await places.suggest("rhone");
    expect(urls).toHaveLength(6);
  });

  it("does not keep an answer the API could not give", async () => {
    let up = false;
    const { fetch, urls } = fakeGeoApi({ "/regions": () => (up ? Response.json([ara]) : new Error("down")) });
    const places = createGeoApiPlaces({ fetch });
    expect(await places.suggest("auvergne")).toEqual([]);
    up = true;
    expect(await places.suggest("auvergne")).toEqual([{ name: "Auvergne-Rhône-Alpes", kind: "region" }]);
    expect(urls).toHaveLength(6);
  });

  it("records each call it makes as geo-api-gouv's, free, without the query", async () => {
    const calls: ExternalApiCall[] = [];
    const { fetch } = fakeGeoApi({ "/communes": () => Response.json([lyon]) });
    await createGeoApiPlaces({ fetch, externalApis: { record: (call) => void calls.push(call) } }).suggest("Lyon");
    expect(calls.map((call) => [call.provider, call.operation, call.ok, call.costEur]).sort()).toEqual([
      ["geo-api-gouv", "GET /communes", true, 0],
      ["geo-api-gouv", "GET /departements", true, 0],
      ["geo-api-gouv", "GET /regions", true, 0],
    ]);
    expect(JSON.stringify(calls)).not.toContain("Lyon");
  });
});
