import { sectorOf, SECTORS, subsectorsOf } from "@jobhub/shared";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { zipOf } from "../test-support/zip";
import { fetchNaf, fetchRomeDomains, NAF_SPARQL_URL, ROME_OPEN_DATA_URL } from "./sources";

/** INSEE's answer, captured on 2026-10-20. */
const NAF_ANSWER = readFileSync(new URL("./fixtures/insee-naf-sparql.json", import.meta.url), "utf8");
/** France Travail's main ROME tree (October 2026, v62), cut to two grand domains, as the archive holds it: in Latin-1. */
const ROME_TREE = readFileSync(new URL("./fixtures/rome-arborescence-principale.latin1.json", import.meta.url));
const romeArchive = () =>
  zipOf({
    "unix_arborescence_competence_v462.json": "{}",
    "unix_arborescence_principale_v462.json": ROME_TREE,
    "version.txt": Buffer.from("Numero de version : 62\r\n\r\nDate de publication : 19/10/2026\r\n", "latin1"),
  });

/** A fetch answering `body` with `status`, and the URLs asked. */
function answering(body: BodyInit | null, status = 200) {
  const asked: URL[] = [];
  const fetch = (async (input: string | URL) => {
    asked.push(new URL(String(input)));
    return new Response(body, { status });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

describe("NAF rév. 2 from INSEE", () => {
  it("is every Sector and Subsector, with its French and English labels, asked of INSEE's SPARQL endpoint", async () => {
    const { fetch, asked } = answering(NAF_ANSWER);

    const naf = await fetchNaf(fetch);

    expect(asked[0]!.origin + asked[0]!.pathname).toBe(NAF_SPARQL_URL);
    expect(asked[0]!.searchParams.get("query")).toContain("nafr2");
    expect(naf.sectors.map((entry) => entry.code)).toEqual(SECTORS);
    expect(naf.sectors[2]).toEqual({ code: "C", label: { fr: "Industrie manufacturière", en: "Manufacturing" } });
    expect(naf.subsectors).toHaveLength(88);
    expect(naf.subsectors.find((entry) => entry.code === "29")).toEqual({
      code: "29",
      parent: "C",
      label: { fr: "Industrie automobile", en: "Manufacture of motor vehicles, trailers and semi-trailers" },
    });
  });

  it("puts each Subsector in the Sector the nomenclature does", async () => {
    const naf = await fetchNaf(answering(NAF_ANSWER).fetch);

    for (const subsector of naf.subsectors) expect(subsector.parent, subsector.code).toBe(sectorOf(subsector.code));
    expect(naf.subsectors.map((entry) => entry.code)).toEqual(SECTORS.flatMap(subsectorsOf));
  });

  it("fails when INSEE does not answer, or answers no Sector", async () => {
    await expect(fetchNaf(answering("busy", 503).fetch)).rejects.toThrow(/503/);
    await expect(fetchNaf(answering(JSON.stringify({ results: { bindings: [] } })).fetch)).rejects.toThrow(/no Sector/);
  });
});

describe("ROME 4.0 professional domains from France Travail's open data", () => {
  it("are each professional domain of the main tree, under its grand domain, read from the archive in Latin-1", async () => {
    const { fetch, asked } = answering(romeArchive());

    const rome = await fetchRomeDomains(fetch);

    expect(asked[0]!.href).toBe(ROME_OPEN_DATA_URL);
    expect(rome.version).toBe("ROME 4.0 v62");
    expect(rome.domains.map((entry) => entry.code)).toEqual(["A11", "A12", "A13", "A14", "A15", "M11", "M12", "M13", "M14", "M15", "M16", "M17", "M18"]);
    expect(rome.domains[0]).toEqual({ code: "A11", parent: "A", label: { fr: "Engins agricoles et forestiers" } });
    expect(rome.domains.find((entry) => entry.code === "M13")?.label.fr).toBe("Direction d'entreprise");
  });

  it("fails when the archive does not come, or holds no main tree", async () => {
    await expect(fetchRomeDomains(answering("not found", 404).fetch)).rejects.toThrow(/404/);
    await expect(fetchRomeDomains(answering(zipOf({ "version.txt": "62" })).fetch)).rejects.toThrow(/main tree/);
    await expect(fetchRomeDomains(answering("not a zip").fetch)).rejects.toThrow();
  });
});
