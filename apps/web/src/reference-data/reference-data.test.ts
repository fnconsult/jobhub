import type { ExternalApiCall } from "@jobhub/shared";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { zipOf } from "../test-support/zip";
import { createReferenceData, migrateReferenceData, RETRY_AFTER_MS } from "./index";

const connectionString = process.env.DATABASE_URL;

const NAF_ANSWER = readFileSync(new URL("./fixtures/insee-naf-sparql.json", import.meta.url), "utf8");
const ROME_TREE = readFileSync(new URL("./fixtures/rome-arborescence-principale.latin1.json", import.meta.url));
const ROME_ARCHIVE = zipOf({ "unix_arborescence_principale_v462.json": ROME_TREE, "version.txt": "Numero de version : 62" });

/** INSEE and France Travail as the module sees them: what each answers, and how many times each was asked. */
function fakeSources() {
  const answers = { naf: { status: 200, body: NAF_ANSWER as BodyInit }, rome: { status: 200, body: ROME_ARCHIVE as BodyInit } };
  const asked = { naf: 0, rome: 0 };
  const fetch = (async (input: string | URL) => {
    const source = new URL(String(input)).host === "rdf.insee.fr" ? "naf" : "rome";
    asked[source]++;
    return new Response(answers[source].body, { status: answers[source].status });
  }) as typeof globalThis.fetch;
  return { fetch, answers, asked };
}

describe.skipIf(!connectionString)("Reference data (needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_reference_data");
    database = throwaway.pool;
    await migrateReferenceData(database);
    await migrateReferenceData(database);
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  it("are asked of INSEE and France Travail on a new database's first read, kept, then read without asking again", async () => {
    const sources = fakeSources();

    const first = await createReferenceData(database, { fetch: sources.fetch }).read();

    expect(first.sectors).toHaveLength(21);
    expect(first.sectors[0]).toEqual({ code: "A", label: { fr: "Agriculture, sylviculture et pêche", en: "Agriculture, forestry and fishing" } });
    expect(first.subsectors).toHaveLength(88);
    expect(first.subsectors.find((entry) => entry.code === "64")).toMatchObject({ parent: "K", label: { fr: "Activités des services financiers, hors assurance et caisses de retraite" } });
    expect(first.domains.map((entry) => entry.code)).toEqual(["A11", "A12", "A13", "A14", "A15", "M11", "M12", "M13", "M14", "M15", "M16", "M17", "M18"]);
    expect(first.domains.find((entry) => entry.code === "M13")).toEqual({ code: "M13", parent: "M", label: { fr: "Direction d'entreprise" } });
    expect(sources.asked).toEqual({ naf: 1, rome: 1 });

    expect(await createReferenceData(database, { fetch: sources.fetch }).read()).toEqual(first);
    expect(sources.asked).toEqual({ naf: 1, rome: 1 });
  });

  it("record each call as its Tool's, never with what it asked", async () => {
    const calls: ExternalApiCall[] = [];

    await createReferenceData(database, { fetch: fakeSources().fetch, externalApis: { record: (call) => void calls.push(call) } }).read();

    expect(calls.map(({ provider, operation, ok }) => ({ provider, operation, ok }))).toEqual(
      expect.arrayContaining([
        { provider: "insee-naf", operation: "GET /sparql", ok: true },
        { provider: "rome-open-data", operation: "GET /api-nomenclatureemploi/v1/open-data/json", ok: true },
      ]),
    );
  });

  it("are replaced by what the sources answer when refreshed", async () => {
    const sources = fakeSources();
    const referenceData = createReferenceData(database, { fetch: sources.fetch });
    await referenceData.read();
    sources.answers.naf.body = NAF_ANSWER.replace("Industrie manufacturière", "Industrie manufacturière (nouveau libellé)");

    expect(await referenceData.refresh()).toEqual({ naf: "refreshed", romeDomains: "refreshed" });

    expect((await referenceData.read()).sectors.find((entry) => entry.code === "C")?.label.fr).toBe("Industrie manufacturière (nouveau libellé)");
    expect(sources.asked).toEqual({ naf: 2, rome: 2 });
  });

  it("keep the labels they had when a source fails to refresh", async () => {
    const sources = fakeSources();
    const referenceData = createReferenceData(database, { fetch: sources.fetch });
    const before = await referenceData.read();
    sources.answers.naf = { status: 503, body: "busy" };

    expect(await referenceData.refresh()).toEqual({ naf: { failed: "rdf.insee.fr answered 503" }, romeDomains: "refreshed" });

    expect(await referenceData.read()).toEqual(before);
  });

  it("are none of a source that fails on a new database, which is not asked again before a while", async () => {
    const sources = fakeSources();
    sources.answers.rome = { status: 404, body: "gone" };
    let now = new Date("2026-10-20T10:00:00Z");
    const referenceData = createReferenceData(database, { fetch: sources.fetch, now: () => now, warn: () => {} });

    const read = await referenceData.read();
    expect(read.sectors).toHaveLength(21);
    expect(read.domains).toEqual([]);
    await referenceData.read();
    expect(sources.asked).toEqual({ naf: 1, rome: 1 });

    now = new Date(now.getTime() + RETRY_AFTER_MS);
    sources.answers.rome = { status: 200, body: ROME_ARCHIVE };
    expect((await referenceData.read()).domains).toHaveLength(13);
    expect(sources.asked).toEqual({ naf: 1, rome: 2 });
  });
});
