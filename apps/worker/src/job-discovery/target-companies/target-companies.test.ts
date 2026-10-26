import type { SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { LaBonneBoite, LaBonneBoiteCompany, LaBonneBoiteSearch } from "../france-travail/la-bonne-boite";
import type { RomePrediction } from "../france-travail/rome-resolution";
import { createTargetCompanies, pickTargetCompanies } from "./index";
import { memoryTargetCompanies } from "./testing";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-26T08:00:00Z");
const daysLater = (days: number) => new Date(NOW.getTime() + days * DAY);

const criteria: SearchCriteria = { targetRole: "Directeur financier", locations: ["Lyon", "Paris"], contractTypes: ["cdi"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

const company = (n: number, hiringScore: number): LaBonneBoiteCompany => ({ siret: `${String(100000000 + n)}00011`, name: `Entreprise ${n}`, hiringScore });

/** La Bonne Boite answering `answer`, and what it was asked. */
function fakeLaBonneBoite(answer: LaBonneBoiteSearch = { ok: true, companies: [company(1, 90), company(2, 80)], calls: 2 }) {
  const asked: Parameters<LaBonneBoite["search"]>[0][] = [];
  const laBonneBoite: LaBonneBoite = {
    search: async (query) => {
      asked.push(query);
      return answer;
    },
  };
  return { laBonneBoite, asked };
}

function setup(options: { laBonneBoite?: LaBonneBoite | null; romeo?: RomePrediction; cityCode?: string | null; max?: number; revisitDays?: number } = {}) {
  const store = memoryTargetCompanies();
  const lbb = fakeLaBonneBoite();
  const laBonneBoite = options.laBonneBoite === undefined ? lbb.laBonneBoite : options.laBonneBoite;
  const romeoAsked: string[] = [];
  const romeo = { predict: async (title: string) => (romeoAsked.push(title), options.romeo ?? { ok: true as const, codes: [], calls: 1 }) };
  const cityAsked: string[] = [];
  const targets = createTargetCompanies({
    store,
    franceTravail: () => (laBonneBoite ? { laBonneBoite, romeo } : null),
    cityCodes: { cityCode: async (location) => (cityAsked.push(location), options.cityCode === undefined ? "69123" : options.cityCode) },
    register: { search: async () => ({ companies: [], soleTraderNamed: false }) },
    settings: () => ({ max: options.max ?? 5, revisitDays: options.revisitDays ?? 7 }),
  });
  return { store, targets, lbb, romeoAsked, cityAsked };
}

const forRun = (targets: ReturnType<typeof setup>["targets"], now = NOW, profileId = "profile-1", searched: SearchCriteria = criteria) =>
  targets.forRun({ candidateId: "candidate-1", profileId, criteria: searched, now });

describe("which Target Companies a run visits: rotation and cap (#406)", () => {
  const listed = (id: string, origin: "la_bonne_boite" | "candidate", hiringScore: number | null, lastVisitedAt: Date | null = null, notACompanyAt: Date | null = null) => ({
    id,
    companyKey: `name:${id}`,
    name: id,
    origin,
    hiringScore,
    city: null,
    activity: null,
    addedAt: NOW,
    lastVisitedAt,
    notACompanyAt,
  });

  it("takes the Candidate's own first, then La Bonne Boite's by hiring score, up to the cap", () => {
    const picked = pickTargetCompanies(
      [listed("lbb-60", "la_bonne_boite", 60), listed("own-b", "candidate", null), listed("lbb-90", "la_bonne_boite", 90), listed("lbb-75", "la_bonne_boite", 75), listed("own-a", "candidate", null), listed("lbb-80", "la_bonne_boite", 80)],
      { max: 5, revisitDays: 7, now: NOW },
    );

    expect(picked.map((target) => target.id)).toEqual(["own-b", "own-a", "lbb-90", "lbb-80", "lbb-75"]);
  });

  it("leaves out for good those the company register said are not companies, visited or not", () => {
    const companies = [listed("sole-trader", "la_bonne_boite", 99, null, daysLater(-30)), listed("own", "candidate", null, daysLater(-30), daysLater(-30)), listed("lbb-70", "la_bonne_boite", 70)];

    expect(pickTargetCompanies(companies, { max: 5, revisitDays: 7, now: NOW }).map((target) => target.id)).toEqual(["lbb-70"]);
  });

  it("leaves out those visited within the delay, and visits them again once it has passed", () => {
    const companies = [listed("lbb-90", "la_bonne_boite", 90, daysLater(-6)), listed("lbb-80", "la_bonne_boite", 80, daysLater(-7)), listed("own", "candidate", null, daysLater(-1)), listed("lbb-70", "la_bonne_boite", 70)];

    expect(pickTargetCompanies(companies, { max: 5, revisitDays: 7, now: NOW }).map((target) => target.id)).toEqual(["lbb-80", "lbb-70"]);
  });

  it("visits none with a cap of 0", () => {
    expect(pickTargetCompanies([listed("own", "candidate", null)], { max: 0, revisitDays: 7, now: NOW })).toEqual([]);
  });

  it("rotates through the list run after run, each visit recorded, never more than the cap", async () => {
    const lbb = fakeLaBonneBoite({ ok: true, companies: [1, 2, 3, 4, 5, 6, 7].map((n) => company(n, 100 - n)), calls: 2 });
    const { targets } = setup({ laBonneBoite: lbb.laBonneBoite, max: 3 });

    const names = async (now: Date) => {
      const run = await forRun(targets, now);
      await targets.visited("profile-1", run.visits, now);
      return run.visits.map((visit) => visit.name);
    };

    expect(await names(NOW)).toEqual(["Entreprise 1", "Entreprise 2", "Entreprise 3"]);
    expect(await names(daysLater(1))).toEqual(["Entreprise 4", "Entreprise 5", "Entreprise 6"]);
    expect(await names(daysLater(2))).toEqual(["Entreprise 7"]);
    expect(await names(daysLater(3))).toEqual([]);
    // A week after its visit, a company is due again.
    expect(await names(daysLater(7))).toEqual(["Entreprise 1", "Entreprise 2", "Entreprise 3"]);
  });

  it("gives each visit the careers site kept for its company", async () => {
    const { targets, store } = setup();
    await store.keepCareersSite("siren:100000001", "https://boards.greenhouse.io/entreprise1", NOW);

    const run = await forRun(targets);

    expect(run.visits.map(({ name, careersSite }) => ({ name, careersSite }))).toEqual([
      { name: "Entreprise 1", careersSite: "https://boards.greenhouse.io/entreprise1" },
      { name: "Entreprise 2", careersSite: null },
    ]);
  });
});

describe("La Bonne Boite's companies for a Profile (#406)", () => {
  it("asks La Bonne Boite for the title's ROME codes within 30 km of the first place's commune, and keeps its companies", async () => {
    const { targets, lbb, cityAsked, store } = setup();

    const run = await forRun(targets);

    expect(lbb.asked).toEqual([{ job: { by: "table", codes: ["M1205"] }, area: { citycode: "69123", distanceKm: 30 } }]);
    expect(cityAsked).toEqual(["Lyon"]);
    expect(run.laBonneBoite).toEqual({ status: "searched", calls: 2 });
    expect((await store.list("profile-1")).map((target) => target.name)).toEqual(["Entreprise 1", "Entreprise 2"]);
  });

  it("asks it again at most monthly for the same job and area", async () => {
    const { targets, lbb } = setup();

    await forRun(targets);
    expect((await forRun(targets, daysLater(29))).laBonneBoite).toEqual({ status: "kept", calls: 0 });
    expect(lbb.asked).toHaveLength(1);

    expect((await forRun(targets, daysLater(31))).laBonneBoite.status).toBe("searched");
    expect(lbb.asked).toHaveLength(2);
  });

  it("asks it again as soon as the Profile's job or area changed", async () => {
    const { targets, lbb } = setup();

    await forRun(targets);
    await forRun(targets, daysLater(1), "profile-1", { ...criteria, targetRole: "DRH" });
    await forRun(targets, daysLater(2), "profile-1", { ...criteria, targetRole: "DRH", locations: ["Nantes"] });

    expect(lbb.asked.map((query) => query.job)).toEqual([
      { by: "table", codes: ["M1205"] },
      { by: "table", codes: ["M1503"] },
      { by: "table", codes: ["M1503"] },
    ]);
  });

  it("asks ROMEO, then gives the free-text job, for a title the table does not know; a place that is no commune goes as text", async () => {
    const { targets, lbb, romeoAsked } = setup({ cityCode: null, romeo: { ok: true, codes: ["H1206"], calls: 2 } });

    const run = await forRun(targets, NOW, "profile-1", { ...criteria, targetRole: "Responsable bureau d'études", locations: ["Rhône"] });

    expect(romeoAsked).toEqual(["Responsable bureau d'études"]);
    expect(lbb.asked).toEqual([{ job: { by: "romeo", codes: ["H1206"] }, area: { location: "Rhône" } }]);
    expect(run.laBonneBoite.calls).toBe(4);
  });

  it("skips La Bonne Boite refused or down like an unavailable source, asking again next run, and still visits the Candidate's own", async () => {
    const lbb = fakeLaBonneBoite({ ok: false, reason: "refused", detail: "token refused (HTTP 400 invalid_scope)", calls: 1 });
    const { targets, store } = setup({ laBonneBoite: lbb.laBonneBoite });
    store.addOwn("profile-1", { name: "Tisserands du Rhône" }, NOW);

    const run = await forRun(targets);

    expect(run.laBonneBoite).toEqual({ status: "refused", calls: 1 });
    expect(run.visits.map((visit) => visit.name)).toEqual(["Tisserands du Rhône"]);
    expect(await store.lastRefresh("profile-1")).toBeNull();
    await forRun(targets, daysLater(1));
    expect(lbb.asked).toHaveLength(2);
  });

  it("is off without France Travail's credentials: only the Candidate's own are visited, nothing is asked", async () => {
    const { targets, store, cityAsked } = setup({ laBonneBoite: null });
    store.addOwn("profile-1", { name: "Tisserands du Rhône" }, NOW);

    const run = await forRun(targets);

    expect(run).toMatchObject({ laBonneBoite: { status: "off", calls: 0 }, visits: [{ name: "Tisserands du Rhône" }] });
    expect(cityAsked).toEqual([]);
  });

  it("never brings back a company set aside", async () => {
    const { targets, store } = setup();
    await forRun(targets);
    store.setAside("profile-1", (await store.list("profile-1"))[0]!.id);

    const run = await forRun(targets, daysLater(40));

    expect(run.visits.map((visit) => visit.name)).toEqual(["Entreprise 2"]);
  });

  it("never fails the run: a store that cannot answer gives no visit", async () => {
    const { targets, store } = setup();
    store.list = async () => {
      throw new Error("database down");
    };

    expect(await forRun(targets)).toMatchObject({ visits: [] });
  });
});
