import { describe, expect, it } from "vitest";
import { createCityCodes } from "./city-codes";

/** geo.api.gouv.fr answering `communes` for every query, and the URLs asked. */
function fakeGeoApi(communes: unknown, status = 200) {
  const asked: URL[] = [];
  const fetch = async (input: string | URL | Request) => {
    asked.push(new URL(String(input)));
    if (status === 0) throw new TypeError("fetch failed");
    return Response.json(communes, { status });
  };
  return { fetch: fetch as typeof globalThis.fetch, asked };
}

describe("a Search Criteria place's commune, for La Bonne Boite's radius (#406)", () => {
  it("asks geo.api.gouv.fr for the most populated commune of that name and gives its INSEE code", async () => {
    const geo = fakeGeoApi([{ code: "69123", nom: "Lyon" }]);

    expect(await createCityCodes({ fetch: geo.fetch }).cityCode("Lyon (69)")).toBe("69123");
    const [url] = geo.asked;
    expect(url!.origin + url!.pathname).toBe("https://geo.api.gouv.fr/communes");
    expect(Object.fromEntries(url!.searchParams)).toEqual({ nom: "Lyon", boost: "population", fields: "code,nom", limit: "1" });
  });

  it("looks a postcode up by postcode", async () => {
    const geo = fakeGeoApi([{ code: "69387", nom: "Lyon 7e Arrondissement" }]);

    expect(await createCityCodes({ fetch: geo.fetch }).cityCode("69007")).toBe("69387");
    expect(Object.fromEntries(geo.asked[0]!.searchParams)).toEqual({ codePostal: "69007", boost: "population", fields: "code,nom", limit: "1" });
  });

  it("gives nothing for a place that is no commune, or when the API cannot answer", async () => {
    expect(await createCityCodes({ fetch: fakeGeoApi([]).fetch }).cityCode("Île-de-France")).toBeNull();
    expect(await createCityCodes({ fetch: fakeGeoApi({ message: "down" }, 503).fetch }).cityCode("Lyon")).toBeNull();
    expect(await createCityCodes({ fetch: fakeGeoApi([], 0).fetch }).cityCode("Lyon")).toBeNull();
    expect(await createCityCodes({ fetch: fakeGeoApi([{ code: "not-a-code" }]).fetch }).cityCode("Lyon")).toBeNull();
  });

  it("asks once per place", async () => {
    const geo = fakeGeoApi([{ code: "69123", nom: "Lyon" }]);
    const codes = createCityCodes({ fetch: geo.fetch });

    await codes.cityCode("Lyon");
    await codes.cityCode(" lyon ");

    expect(geo.asked).toHaveLength(1);
  });
});
