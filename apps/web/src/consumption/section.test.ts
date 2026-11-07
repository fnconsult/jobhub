import type { Locale } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import type { ConsumptionDay } from "./index";
import { consumptionPeriod, consumptionSection, readRange, type ConsumptionPeriod } from "./section";

const STANDARD_QUOTAS = { matchScores: 50, atsScores: 10, enrichedContacts: 0, jobSearches: 7 };
const NONE_USED = { matchScores: 0, atsScores: 0, enrichedContacts: 0, jobSearches: 0 };

/** Paid monthly, as Stripe gives it: from 18 October 10:00 to 18 November 10:00, renewed before. */
const MONTHLY = { kind: "billed", start: new Date("2026-10-18T08:00:00Z"), end: new Date("2026-11-18T09:00:00Z"), renewedBefore: true } as const;
const NOW = new Date("2026-11-05T10:00:00Z");

function section(period: ConsumptionPeriod, days: ConsumptionDay[], { now = NOW, locale = "fr" as Locale, quotas = STANDARD_QUOTAS, usedThisWeek = NONE_USED } = {}) {
  return consumptionSection({ period, days, now, quotas, usedThisWeek, locale });
}

describe("consumptionPeriod — the billing period « Votre consommation » counts over (#801, ADR-0091)", () => {
  it("on a monthly paid Plan, runs from the French day Stripe's period starts to the day before it renews", () => {
    const period = consumptionPeriod(MONTHLY, NOW);
    expect(period).toMatchObject({ kind: "billed", first: "2026-10-18", last: "2026-11-17", renewal: "2026-11-18", length: 31, today: 19 });
    // The same 19 days at the start of the previous period.
    expect(period.previous).toEqual({ first: "2026-09-18", last: "2026-10-06" });
  });

  it("on a yearly paid Plan, runs over the year; the previous year is beyond the 12 months kept, so nothing is compared", () => {
    const period = consumptionPeriod({ kind: "billed", start: new Date("2026-03-10T09:00:00Z"), end: new Date("2027-03-10T09:00:00Z"), renewedBefore: true }, NOW);
    expect(period).toMatchObject({ first: "2026-03-10", last: "2027-03-09", renewal: "2027-03-10", length: 365, today: 241, previous: null });
  });

  it("compares nothing in a subscription's first period", () => {
    expect(consumptionPeriod({ ...MONTHLY, renewedBefore: false }, NOW).previous).toBeNull();
  });

  it("on Free, is the calendar month in French time: 23:30 on the 31st is still October, 00:30 is November", () => {
    const since = new Date("2026-01-15T10:00:00Z");
    const october = consumptionPeriod({ kind: "month", free: true, since }, new Date("2026-10-31T22:30:00Z"));
    expect(october).toMatchObject({ kind: "month", free: true, first: "2026-10-01", last: "2026-10-31", length: 31, today: 31 });
    // 31 days against September's 30: the 31 days before October.
    expect(october.previous).toEqual({ first: "2026-08-31", last: "2026-09-30" });

    const november = consumptionPeriod({ kind: "month", free: true, since }, new Date("2026-10-31T23:30:00Z"));
    expect(november).toMatchObject({ first: "2026-11-01", last: "2026-11-30", length: 30, today: 1 });
    expect(november.previous).toEqual({ first: "2026-10-01", last: "2026-10-01" });
  });

  it("on Free, compares nothing for an account made this month", () => {
    expect(consumptionPeriod({ kind: "month", free: true, since: new Date("2026-11-02T10:00:00Z") }, NOW).previous).toBeNull();
  });

  it("compares the same number of days when the previous period is shorter (day 31 of March against February)", () => {
    const march = consumptionPeriod({ kind: "month", free: true, since: new Date("2025-06-01T10:00:00Z") }, new Date("2026-03-31T10:00:00Z"));
    // 31 days ending the day before the month: from 29 January.
    expect(march.previous).toEqual({ first: "2026-01-29", last: "2026-02-28" });
  });

  it("reads the 12 months kept, from the day 12 months ago to today", () => {
    expect(readRange(NOW)).toEqual({ from: new Date("2025-11-05T12:00:00Z"), to: NOW });
  });
});

/** The text with its non-breaking spaces (« 44 % ») as plain ones. */
const plain = (text: string | null | undefined) => text?.replace(/[\u00a0\u202f]/g, " ");

const day = (date: string, tool: ConsumptionDay["tool"], count: number): ConsumptionDay => ({ day: date, tool, count });

describe("consumptionSection — the headline and the list per Tool", () => {
  const period = consumptionPeriod(MONTHLY, NOW);
  const days = [
    day("2026-09-20", "coach", 50), // previous period, within its first 19 days
    day("2026-10-10", "coach", 99), // previous period, after its first 19 days: not compared
    day("2026-10-18", "coach", 20),
    day("2026-10-18", "matchScore", 10),
    day("2026-11-01", "jobSearch", 4),
    day("2026-11-02", "tailoredCv", 3),
    day("2026-11-03", "tailoredDocument", 2),
    day("2026-11-04", "atsScore", 3),
    day("2026-11-04", "companyDossier", 1),
    day("2026-11-05", "enrichedContact", 1),
    day("2026-11-05", "cvReading", 1),
  ];
  const view = section(period, days, { usedThisWeek: { matchScores: 4, atsScores: 10, enrichedContacts: 0, jobSearches: 2 } });

  it("counts the AI actions of the period, and its change against the same days of the previous period", () => {
    expect(view.total).toBe(45);
    expect(view.totalText).toBe("45 actions IA");
    expect(plain(view.change)).toBe("−10 % par rapport au même jour de la période précédente");
    expect(view.periodLabel).toBe("Période de facturation du 18 octobre au 17 novembre");
    expect(view.progress).toMatchObject({ text: "Jour 19 sur 31", start: "18 oct.", end: "renouvellement 18 nov.", percent: 61 });
  });

  it("lists the five first Tools on their own and the four others under « Autres », the counts adding up to the headline", () => {
    expect(view.tools.map((line) => line.key)).toEqual(["coach", "jobSearch", "matchScore", "tailoredCv", "tailoredDocument", "others"]);
    const others = view.tools.at(-1)!;
    expect(others.label).toBe("Autres");
    expect(others.parts.map((part) => [part.key, part.count])).toEqual([
      ["atsScore", 3],
      ["companyDossier", 1],
      ["enrichedContact", 1],
      ["cvReading", 1],
    ]);
    expect(others.count).toBe(6);
    expect(view.tools.reduce((sum, line) => sum + line.count, 0)).toBe(view.total);
  });

  it("gives each line its share of the actions, the shares adding up to 100 % and « Autres » to its parts'", () => {
    expect(view.tools.reduce((sum, line) => sum + line.share, 0)).toBe(100);
    const others = view.tools.at(-1)!;
    expect(others.share).toBe(others.parts.reduce((sum, part) => sum + part.share, 0));
    expect(view.tools[0]!.countText).toBe("20 réponses");
    expect(plain(view.tools[1]!.shareText)).toBe("9 % de vos actions"); // 4 of 45
    expect(view.tools.map((line) => line.share)).toEqual([45, 9, 22, 7, 4, 13]);
    expect(view.tools[3]!.countText).toBe("3 CV");
    expect(others.parts[1]!.countText).toBe("1 dossier");
  });

  it("repeats this week's Plan Quota use beside a Tool that has one, in warn once used up, or says it is not included or without limit", () => {
    const byKey = Object.fromEntries([...view.tools, ...view.tools.at(-1)!.parts].map((line) => [line.key, line]));
    expect(byKey.jobSearch!.quota).toEqual({ text: "2 sur 7 cette semaine", usedUp: false });
    expect(byKey.matchScore!.quota).toEqual({ text: "4 sur 50 cette semaine", usedUp: false });
    expect(byKey.atsScore!.quota).toEqual({ text: "10 sur 10 cette semaine", usedUp: true });
    expect(byKey.enrichedContact!.quota).toEqual({ text: "Non compris dans votre offre", usedUp: false });
    expect(byKey.coach!.quota).toBeNull();
    expect(byKey.coach!.note).toBe("Sans limite dans votre offre");
    expect(byKey.jobSearch!.note).toBeNull();
    expect(byKey.others!.note).toBeNull();
  });

  it("says nothing of a change when there was no previous period, or nothing in it to compare with", () => {
    expect(section(consumptionPeriod({ ...MONTHLY, renewedBefore: false }, NOW), days).change).toBeNull();
    expect(section(period, days.filter((each) => each.day >= "2026-10-01")).change).toBeNull();
  });

  it("speaks English to an English-speaking Candidate", () => {
    const english = section(period, days, { locale: "en" });
    expect(english.totalText).toBe("45 AI actions");
    expect(plain(english.change)).toBe("−10% compared with the same day of the previous period");
    expect(english.periodLabel).toBe("Billing period from October 18 to November 17");
    expect(english.tools[0]!.countText).toBe("20 replies");
  });

  it("labels Free's month as not billed, ending at the end of the month", () => {
    const free = section(consumptionPeriod({ kind: "month", free: true, since: new Date("2026-01-15T10:00:00Z") }, NOW), [...days, day("2026-10-03", "coach", 10)]);
    expect(free.periodLabel).toBe("Mois de novembre (l'offre Gratuite n'est pas facturée)");
    expect(free.progress).toMatchObject({ text: "Jour 5 sur 30", start: "1 nov.", end: "fin du mois" });
    expect(plain(free.change)).toBe("+50 % par rapport au même jour du mois précédent");
    expect(section(consumptionPeriod({ kind: "month", free: true, since: new Date("2026-01-15T10:00:00Z") }, new Date("2026-10-05T10:00:00Z")), []).periodLabel).toBe(
      "Mois d'octobre (l'offre Gratuite n'est pas facturée)",
    );
  });
});

describe("consumptionSection — day by day, over twelve months", () => {
  const period = consumptionPeriod(MONTHLY, NOW);
  const days = [day("2025-11-05", "coach", 1), day("2026-06-01", "coach", 2), day("2026-10-18", "coach", 8), day("2026-10-18", "jobSearch", 4), day("2026-11-05", "cvReading", 3)];
  const view = section(period, days);
  const cells = view.grid.weeks.flat().filter((cell) => cell !== null);

  it("draws one cell per day of the 12 months kept, a column per week, Monday first", () => {
    expect(view.grid.weeks.every((week) => week.length === 7)).toBe(true);
    expect(cells[0]!.day).toBe("2025-11-05");
    expect(cells.at(-1)!.day).toBe("2026-11-05");
    expect(cells).toHaveLength(366);
    // 5 November 2025 was a Wednesday: the first column starts on the Monday before, its first two days blank.
    expect(view.grid.weeks[0]!.slice(0, 3).map((cell) => cell?.day ?? null)).toEqual([null, null, "2025-11-05"]);
    expect(view.grid.weekdays).toEqual(["lun.", "", "mer.", "", "ven.", "", ""]);
    expect(view.grid.months[0]).toEqual({ week: 0, label: "nov." });
  });

  it("shades each day in five steps of the accent, up to the 12 months' busiest day, and outlines the current period", () => {
    const of = (date: string) => cells.find((cell) => cell.day === date)!;
    expect(of("2026-10-18")).toMatchObject({ total: 12, level: 4, inPeriod: true });
    expect(of("2026-11-05")).toMatchObject({ total: 3, level: 1, inPeriod: true });
    expect(of("2026-06-01")).toMatchObject({ total: 2, level: 1, inPeriod: false });
    expect(of("2026-10-17")).toMatchObject({ total: 0, level: 0, inPeriod: false });
    expect(of("2026-10-18").label).toBe("Dimanche 18 octobre 2026");
  });

  it("gives each day its count per series: the five first Tools, then « Autres »", () => {
    expect(view.series.map((series) => series.label)).toEqual(["Coach IA", "Recherches d'offres", "Match Score", "CV adapté", "Lettres et messages d'approche", "Autres"]);
    expect(cells.find((cell) => cell.day === "2026-10-18")!.counts).toEqual([8, 4, 0, 0, 0, 0]);
    expect(cells.find((cell) => cell.day === "2026-11-05")!.counts).toEqual([0, 0, 0, 0, 0, 3]);
  });

  it("gives the period day by day for the bars, the days to come empty", () => {
    expect(view.bars.days).toHaveLength(31);
    expect(view.bars.days[0]).toMatchObject({ day: "2026-10-18", total: 12, short: "18 oct." });
    expect(view.bars.days.filter((bar) => bar.future)).toHaveLength(12);
    expect(view.bars.max).toBe(12);
  });

  it("serializes to plain data, never a token count or an amount in euros", () => {
    const text = JSON.stringify(section(period, days)) + JSON.stringify(section(period, days, { locale: "en" }));
    expect(text).not.toMatch(/tokens?|jetons?/i);
    expect(text).not.toMatch(/€|\beur\b|euros?/i);
  });
});
