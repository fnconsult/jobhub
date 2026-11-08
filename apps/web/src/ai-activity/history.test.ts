import type { ProvenanceSite } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { ActivityEntry, EntryCost } from "./entries";
import { costShown, entryToOpen, historyByDay, pageSources, pageSummary, type QuotaUse } from "./history";
import type { ActivityModel } from "./pane";

/**
 * The history under « En ce moment » (ADR-0086, #808): the page's Activité entries by day, newest first, each with its
 * cost as the Candidate reads it (never in euros), and the page's Sources et outils once each.
 */

const ZONE = "Europe/Paris";
const NOW = new Date("2026-11-05T15:00:00.000Z");

const NO_COST: EntryCost = { quota: null, tokens: null, noAi: false };

function entry(key: string, at: string | null, more: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    key,
    kind: "job_search",
    at,
    object: { href: null, label: null },
    origin: "candidate",
    result: { end: { state: "done" } },
    steps: [],
    sites: [],
    tools: [],
    models: [],
    cost: NO_COST,
    ...more,
  };
}

describe("historyByDay", () => {
  it("groups the entries by day in the Candidate's time zone, today first, keeping their order", () => {
    const entries = [
      entry("a", "2026-11-05T14:00:00.000Z"),
      entry("b", "2026-11-05T08:00:00.000Z"),
      // 00:30 in Paris on 5 November, though still the 4th in UTC.
      entry("c", "2026-11-04T23:30:00.000Z"),
      entry("d", "2026-10-27T19:40:00.000Z"),
      entry("e", "2025-12-31T10:00:00.000Z"),
    ];
    const days = historyByDay(entries, NOW, ZONE);
    expect(days.map(({ key, today, entries }) => ({ key, today, keys: entries.map((each) => each.key) }))).toEqual([
      { key: "2026-11-05", today: true, keys: ["a", "b", "c"] },
      { key: "2026-10-27", today: false, keys: ["d"] },
      { key: "2025-12-31", today: false, keys: ["e"] },
    ]);
    expect(days[1]!.at).toBe("2026-10-27T19:40:00.000Z");
  });

  it("puts an entry whose time is not known last, in a day of its own", () => {
    const days = historyByDay([entry("a", "2026-11-05T14:00:00.000Z"), entry("old", null)], NOW, ZONE);
    expect(days.map((day) => [day.key, day.today, day.at])).toEqual([
      ["2026-11-05", true, "2026-11-05T14:00:00.000Z"],
      ["undated", false, null],
    ]);
  });

  it("is empty with no entry", () => {
    expect(historyByDay([], NOW, ZONE)).toEqual([]);
  });
});

describe("costShown", () => {
  const usage: QuotaUse[] = [
    { quota: "jobSearches", used: 4, limit: 7 },
    { quota: "atsScores", used: 1, limit: null },
  ];

  it("a Plan Quota with the week's use the Usage Meter reads: « 1 recherche du forfait · 4 sur 7 cette semaine »", () => {
    expect(costShown(entry("s", null, { cost: { quota: "jobSearches", tokens: { count: 36_100, calls: null, partial: false }, noAi: false } }), usage)).toEqual({
      quota: { quota: "jobSearches", week: { used: 4, limit: 7 } },
      consumption: false,
      tokens: { count: 36_100, calls: null, partial: false },
      noAi: false,
    });
  });

  it("a Plan Quota without a limit, or with no Usage Meter, says no counter", () => {
    const score = entry("s", null, { kind: "ats_score", cost: { quota: "atsScores", tokens: null, noAi: true } });
    expect(costShown(score, usage).quota).toEqual({ quota: "atsScores", week: null });
    expect(costShown(score, null).quota).toEqual({ quota: "atsScores", week: null });
  });

  it("AI without a Plan Quota is « compté dans votre consommation », with no counter", () => {
    const reply = entry("r", null, { kind: "coach_reply", cost: { quota: null, tokens: { count: 22_200, calls: 4, partial: false }, noAi: false } });
    expect(costShown(reply, usage)).toEqual({ quota: null, consumption: true, tokens: { count: 22_200, calls: 4, partial: false }, noAi: false });
  });

  it("what rules or the Candidate made is « Sans IA », counted nowhere", () => {
    const version = entry("v", null, { kind: "master_cv_version", cost: { quota: null, tokens: null, noAi: true } });
    expect(costShown(version, usage)).toEqual({ quota: null, consumption: false, tokens: null, noAi: true });
  });

  it("an element whose Provenance was not kept says nothing of its cost", () => {
    expect(costShown(entry("o", null, { unrecorded: true }), usage)).toEqual({ quota: null, consumption: false, tokens: null, noAi: false });
  });
});

describe("pageSources", () => {
  const airbus = (link: string): ProvenanceSite => ({ kind: "web", domain: "airbus.com", links: [link] });

  it("lists each Provenance site once, its links joined, and each Tool once, Jobbbox's rules among them", () => {
    const sources = pageSources([
      entry("a", null, { sites: [airbus("https://airbus.com/1"), { kind: "candidate", links: ["/profils/p"] }], tools: [{ name: "Brave Search", ms: 2_000 }, { name: null, ms: 40 }] }),
      entry("b", null, { sites: [airbus("https://airbus.com/2"), airbus("https://airbus.com/1")], tools: [{ name: "Brave Search", ms: 1_000 }] }),
    ]);
    expect(sources.sites).toEqual([
      { kind: "web", domain: "airbus.com", links: ["https://airbus.com/1", "https://airbus.com/2"] },
      { kind: "candidate", links: ["/profils/p"] },
    ]);
    expect(sources.tools.map((tool) => tool.name)).toEqual(["Brave Search", null]);
  });

  it("has nothing for a page whose entries name none", () => {
    expect(pageSources([entry("a", null)])).toEqual({ sites: [], tools: [] });
  });
});

describe("entryToOpen", () => {
  const reply = entry("coach_reply:2026-11-05T14:00:00.000Z", "2026-11-05T14:00:00.000Z", {
    kind: "coach_reply",
    messageId: "2026-11-05T14:00:00.000Z",
    proposals: [
      { object: { href: "/p", label: "P" }, what: "Lieux", before: "a", after: "b", state: "dismissed", led: null },
      { object: { href: "/p", label: "P" }, what: "CV", before: "v6", after: "v7", state: "applied", led: "master_cv_version:7" },
    ],
  });
  const entries = [entry("master_cv_version:7", "2026-11-05T14:05:00.000Z", { kind: "master_cv_version" }), reply];

  it("« Dans l'activité » under a reply opens its entry", () => {
    expect(entryToOpen(entries, { messageId: "2026-11-05T14:00:00.000Z" })).toBe(reply.key);
  });

  it("under an applied card, the entry it led to; under one not applied, its reply's", () => {
    expect(entryToOpen(entries, { messageId: "2026-11-05T14:00:00.000Z", card: 1 })).toBe("master_cv_version:7");
    expect(entryToOpen(entries, { messageId: "2026-11-05T14:00:00.000Z", card: 0 })).toBe(reply.key);
  });

  it("none for a message the page has no entry of", () => {
    expect(entryToOpen(entries, { messageId: "elsewhere" })).toBeNull();
  });
});

describe("pageSummary", () => {
  const model = (name: string): ActivityModel => ({ name, ids: [name], where: null, euAiConsent: false, outsideEu: false, tokens: null, ms: null });
  const tokens = (count: number): EntryCost => ({ ...NO_COST, tokens: { count, calls: null, partial: false } });

  it("is what AI Activity's button says of the page (#369, #809): its models once each, and the tokens of its entries summed", () => {
    const entries = [
      entry("a", null, { models: [model("Claude Opus 5"), model("Mistral Small")], cost: tokens(6_900) }),
      entry("b", null, { models: [model("Claude Opus 5")], cost: tokens(4_000) }),
      entry("c", null, { models: [model("Mistral Large")] }),
    ];

    expect(pageSummary(entries)).toEqual({ models: 3, tokens: 10_900 });
  });

  it("has no tokens when none were kept", () => {
    expect(pageSummary([entry("a", null, { models: [model("Claude Opus 5")] })])).toEqual({ models: 1, tokens: null });
  });

  it("is nothing on a page where no model served: none recorded, or Jobbbox's rules alone, so the button has no words", () => {
    expect(pageSummary([])).toBeNull();
    expect(pageSummary([entry("a", null, { cost: { ...NO_COST, noAi: true } }), entry("b", null, { unrecorded: true })])).toBeNull();
  });
});
