/**
 * « Votre consommation » (#801, ADR-0091): what Mon abonnement shows of the Candidate's Consumption. Two pure steps,
 * so the page only reads and draws:
 *  - `consumptionPeriod(source, now)` — the billing period: Stripe's current period on a paid Plan (French days, from
 *    its start to the day before it renews), the calendar month in French time on Free; how far into it today is; and
 *    the days of the previous period it is compared with (as many as have passed of this one), when there was one
 *    and they are within the 12 months kept;
 *  - `consumptionSection({ period, days, … })` — from the 12 months' daily counts (`readRange` is what to read), the
 *    section as plain data, in the Candidate's language: the headline (AI actions and their change), the period's
 *    progress, one line per Tool (the four last under « Autres ») with its share and this week's Plan Quota, the
 *    12-month grid and the period's bars.
 * Uses and AI actions only: never jetons, never euros (#332, `billing/no-token-count.test.ts`).
 */
import { CONSUMPTION_TOOLS, consumptionTools, QUOTA_CONSUMPTION_TOOLS, WEEKLY_QUOTAS, type ConsumptionTool, type WeeklyQuota } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { dayInFrance, RETENTION_MONTHS, type ConsumptionDay } from "./index";

/** Where the period comes from: Stripe's current period (`renewedBefore`: the subscription had one before it), or a calendar month. */
export type PeriodSource =
  | { kind: "billed"; start: Date; end: Date; renewedBefore: boolean }
  /** `free`: the Candidate is on Free (never billed); otherwise a paid Plan whose period Stripe could not give. `since`: when the account was made. */
  | { kind: "month"; free: boolean; since: Date };

/** A range of French days, both ends included ("2026-10-18"). */
export interface DayRange {
  first: string;
  last: string;
}

export interface ConsumptionPeriod extends DayRange {
  kind: PeriodSource["kind"];
  free: boolean;
  /** The day the next period starts (a paid Plan's renewal), the day after `last`. */
  renewal: string;
  /** How many days the period has. */
  length: number;
  /** Which of them today is, from 1. */
  today: number;
  /** The same number of days of the previous period, which the change compares with; null when there is none to compare. */
  previous: DayRange | null;
}

/** The six series the section draws: the five first Tools on their own, then « Autres ». */
const OWN_TOOLS = consumptionTools().slice(0, 5);
const OTHER_TOOLS = consumptionTools().slice(5);
export type SeriesKey = ConsumptionTool | "others";
const SERIES: SeriesKey[] = [...OWN_TOOLS, "others"];

/** The weekly Plan Quota a Tool's uses count against, if any. */
const QUOTA_OF = Object.fromEntries(WEEKLY_QUOTAS.map((quota) => [QUOTA_CONSUMPTION_TOOLS[quota], quota])) as Partial<Record<ConsumptionTool, WeeklyQuota>>;

// ---- French days, as dates at noon UTC (never across a day boundary) ----

const asDate = (day: string) => new Date(`${day}T12:00:00Z`);
const asDay = (date: Date) => date.toISOString().slice(0, 10);

function addDays(day: string, n: number): string {
  const date = asDate(day);
  date.setUTCDate(date.getUTCDate() + n);
  return asDay(date);
}

/** The same day `n` months on, or the month's last day when it has none (31 March less one month: 28 February). */
function addMonths(day: string, n: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(year, month - 1 + n, 1, 12));
  const lastOfMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  first.setUTCDate(Math.min(date, lastOfMonth));
  return asDay(first);
}

/** How many days from `first` to `last`, both included. */
const daysFrom = (first: string, last: string) => Math.round((asDate(last).getTime() - asDate(first).getTime()) / 86_400_000) + 1;

/** The first day the 12 months kept hold: the day RETENTION_MONTHS ago, French time (the purge keeps it). */
const firstKept = (now: Date) => addMonths(dayInFrance(now), -RETENTION_MONTHS);

/** What to read of the Candidate's Consumption for the section: the 12 months kept, to today. */
export function readRange(now: Date): { from: Date; to: Date } {
  return { from: asDate(firstKept(now)), to: now };
}

export function consumptionPeriod(source: PeriodSource, now: Date): ConsumptionPeriod {
  const today = dayInFrance(now);
  let first: string;
  let renewal: string;
  let previousFirst: string;
  let hadPrevious: boolean;
  if (source.kind === "billed") {
    first = dayInFrance(source.start);
    renewal = dayInFrance(source.end) > first ? dayInFrance(source.end) : addDays(first, 1);
    // Stripe gives only the current period: the previous one is as many months back (a monthly or a yearly Plan), or days.
    const months = Math.round(daysFrom(first, renewal) / 30.44);
    previousFirst = months >= 1 ? addMonths(first, -months) : addDays(first, -(daysFrom(first, renewal) - 1));
    hadPrevious = source.renewedBefore;
  } else {
    first = `${today.slice(0, 7)}-01`;
    renewal = addMonths(first, 1);
    previousFirst = addMonths(first, -1);
    hadPrevious = dayInFrance(source.since) < first;
  }
  const last = addDays(renewal, -1);
  const length = daysFrom(first, last);
  const elapsed = Math.min(length, Math.max(1, daysFrom(first, today)));
  // As many days as have passed of this period; if the previous one is shorter, the days just before this one.
  let previous: DayRange | null = { first: previousFirst, last: addDays(previousFirst, elapsed - 1) };
  if (previous.last >= first) previous = { first: addDays(first, -elapsed), last: addDays(first, -1) };
  if (!hadPrevious || previous.first < firstKept(now)) previous = null;
  return { kind: source.kind, free: source.kind === "month" && source.free, first, last, renewal, length, today: elapsed, previous };
}

// ---- The section ----

/** One day of the grid or the bars: its count per series (SERIES' order) and its shade, 0 for none, then 1 to 4. */
export interface ConsumptionDayView {
  day: string;
  /** « Dimanche 18 octobre 2026 ». */
  label: string;
  /** « 18 oct. »: the bars' axis. */
  short: string;
  counts: number[];
  total: number;
  level: 0 | 1 | 2 | 3 | 4;
  /** Inside the current billing period: outlined on the grid. */
  inPeriod: boolean;
  /** A day of the period still to come: an empty bar. */
  future: boolean;
}

export interface ConsumptionToolLine {
  key: SeriesKey;
  label: string;
  count: number;
  /** « 12 réponses ». */
  countText: string;
  /** Its share of the period's actions in whole percent; the lines add up to 100 when there are any. */
  share: number;
  /** « 26 % de vos actions ». */
  shareText: string;
  /** This week's use of its weekly Plan Quota, « 4 sur 7 cette semaine », used up or not; or « Non compris dans votre offre ». */
  quota: { text: string; usedUp: boolean } | null;
  /** « Sans limite dans votre offre », for a Tool without a weekly Plan Quota. */
  note: string | null;
  /** « Autres »'s Tools, each with its own line. */
  parts: ConsumptionToolLine[];
}

export interface ConsumptionSectionView {
  /** « Période de facturation du 18 octobre au 17 novembre », or Free's month. */
  periodLabel: string;
  free: boolean;
  total: number;
  /** « 248 actions IA », and its number and unit apart (« 248 », « actions IA ») for the headline. */
  totalText: string;
  totalNumber: string;
  totalUnit: string;
  /** « +15 % par rapport au même jour de la période précédente »; null without a previous period, or nothing in it. */
  change: string | null;
  progress: { text: string; label: string; percent: number; start: string; end: string };
  tools: ConsumptionToolLine[];
  series: { key: SeriesKey; label: string }[];
  grid: {
    /** One column per week, Monday first; null outside the 12 months kept or after today. */
    weeks: (ConsumptionDayView | null)[][];
    /** A month's short name over the column where it starts. */
    months: { week: number; label: string }[];
    /** The rows' names, every other one (« lun. », « mer. », « ven. »). */
    weekdays: string[];
  };
  bars: { days: ConsumptionDayView[]; max: number };
}

/**
 * Whole percents of `counts` that add up to 100 (largest remainders, the earlier Tool first on a tie), or all 0 when
 * there is nothing.
 */
function shares(counts: number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return counts.map(() => 0);
  // In whole numbers, so two equal remainders are equal: count × 100 = share × total + rest.
  const result = counts.map((count) => Math.floor((count * 100) / total));
  const order = counts.map((count, index) => ({ index, rest: (count * 100) % total })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (let given = 0, left = 100 - result.reduce((sum, value) => sum + value, 0); given < left; given++) result[order[given]!.index]! += 1;
  return result;
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

export function consumptionSection({
  period,
  days,
  now,
  quotas,
  usedThisWeek,
  locale,
}: {
  period: ConsumptionPeriod;
  /** The Candidate's counts over `readRange(now)`. */
  days: readonly ConsumptionDay[];
  now: Date;
  quotas: Record<WeeklyQuota, number | null>;
  usedThisWeek: Record<WeeklyQuota, number>;
  locale: Locale;
}): ConsumptionSectionView {
  const { t } = createI18n(locale);
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const plural = new Intl.PluralRules(locale);
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
  const dayMonth = format({ day: "numeric", month: "long" });
  const dayMonthYear = format({ day: "numeric", month: "long", year: "numeric" });
  const short = format({ day: "numeric", month: "short" });
  const long = format({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const monthName = format({ month: "long" });
  const monthShort = format({ month: "short" });
  const weekday = format({ weekday: "short" });

  const today = dayInFrance(now);
  const inRange = (day: string, range: DayRange) => day >= range.first && day <= range.last;

  // Each day's count per Tool, and the totals of the period and of the previous one's compared days.
  const byDay = new Map<string, Record<ConsumptionTool, number>>();
  const periodTotals = Object.fromEntries(consumptionTools().map((tool) => [tool, 0])) as Record<ConsumptionTool, number>;
  let previousTotal = 0;
  for (const { day, tool, count } of days) {
    const counts = byDay.get(day) ?? (Object.fromEntries(consumptionTools().map((each) => [each, 0])) as Record<ConsumptionTool, number>);
    counts[tool] += count;
    byDay.set(day, counts);
    if (inRange(day, period)) periodTotals[tool] += count;
    if (period.previous && inRange(day, period.previous)) previousTotal += count;
  }
  const total = consumptionTools().reduce((sum, tool) => sum + periodTotals[tool], 0);

  // The headline and its change, signed in words' order: « +15 % », « −8 % ».
  let change: string | null = null;
  if (period.previous && previousTotal > 0) {
    const ratio = Math.round(((total - previousTotal) / previousTotal) * 100);
    const sign = ratio > 0 ? "+" : ratio < 0 ? "−" : "";
    change = t(period.kind === "billed" ? "billing.consumption.changeBilled" : "billing.consumption.changeMonth", { change: `${sign}${percent.format(Math.abs(ratio) / 100)}` });
  }

  // The period's name and progress.
  const sameYear = period.first.slice(0, 4) === period.last.slice(0, 4);
  const dated = sameYear ? dayMonth : dayMonthYear;
  let periodLabel: string;
  if (period.kind === "billed") {
    periodLabel = t("billing.consumption.periodBilled", { start: dated.format(asDate(period.first)), end: dated.format(asDate(period.last)) });
  } else {
    const name = monthName.format(asDate(period.first));
    // « Mois de novembre », « Mois d'octobre »; « November » in English.
    const month = locale === "fr" ? (/^[aeiouyàâéèêh]/i.test(name) ? `d'${name}` : `de ${name}`) : capitalize(name);
    periodLabel = t(period.free ? "billing.consumption.periodFree" : "billing.consumption.periodMonth", { month });
  }
  const progress = {
    text: t("billing.consumption.dayOf", { day: period.today, days: period.length }),
    label: t("billing.consumption.progressLabel", { day: period.today, days: period.length, start: dated.format(asDate(period.first)), end: dated.format(asDate(period.last)) }),
    percent: Math.round((period.today / period.length) * 100),
    start: short.format(asDate(period.first)),
    end: period.kind === "billed" ? t("billing.consumption.renewal", { date: short.format(asDate(period.renewal)) }) : t("billing.consumption.monthEnd"),
  };

  // One line per Tool, « Autres » holding the last four.
  const toolShares = shares(consumptionTools().map((tool) => periodTotals[tool]));
  const shareOf = Object.fromEntries(consumptionTools().map((tool, index) => [tool, toolShares[index]!])) as Record<ConsumptionTool, number>;
  const countText = (count: number, wording: { unit: string; one: string }) => `${number.format(count)} ${plural.select(count) === "one" ? wording.one : wording.unit}`;
  const shareText = (share: number) => t("billing.consumption.share", { percent: percent.format(share / 100) });
  const toolLine = (tool: ConsumptionTool): ConsumptionToolLine => {
    const quota = QUOTA_OF[tool];
    const limit = quota ? quotas[quota] : null;
    return {
      key: tool,
      label: CONSUMPTION_TOOLS[tool][locale].label,
      count: periodTotals[tool],
      countText: countText(periodTotals[tool], CONSUMPTION_TOOLS[tool][locale]),
      share: shareOf[tool],
      shareText: shareText(shareOf[tool]),
      quota:
        quota && limit === 0
          ? { text: t("billing.consumption.notIncluded"), usedUp: false }
          : quota && limit !== null
            ? { text: t("billing.consumption.quotaWeek", { used: number.format(usedThisWeek[quota]), limit: number.format(limit) }), usedUp: usedThisWeek[quota] >= limit }
            : null,
      note: quota && limit !== null ? null : t("billing.consumption.unlimited"),
      parts: [],
    };
  };
  const parts = OTHER_TOOLS.map(toolLine);
  const othersCount = parts.reduce((sum, part) => sum + part.count, 0);
  const othersShare = parts.reduce((sum, part) => sum + part.share, 0);
  const others: ConsumptionToolLine = {
    key: "others",
    label: t("billing.consumption.others"),
    count: othersCount,
    countText: t("billing.consumption.actions", { count: othersCount, number: number.format(othersCount) }),
    share: othersShare,
    shareText: shareText(othersShare),
    quota: null,
    note: null,
    parts,
  };
  const tools = [...OWN_TOOLS.map(toolLine), others];
  const series = SERIES.map((key) => ({ key, label: key === "others" ? others.label : CONSUMPTION_TOOLS[key][locale].label }));

  // Day by day: the 12 months for the grid, the period for the bars, one shade scale up to the 12 months' busiest day.
  const countsOf = (day: string) => {
    const counts = byDay.get(day);
    return SERIES.map((key) => (counts ? (key === "others" ? OTHER_TOOLS.reduce((sum, tool) => sum + counts[tool], 0) : counts[key]) : 0));
  };
  const kept = firstKept(now);
  let busiest = 0;
  for (const [day, counts] of byDay) if (day >= kept && day <= today) busiest = Math.max(busiest, Object.values(counts).reduce((sum, count) => sum + count, 0));
  const dayView = (day: string): ConsumptionDayView => {
    const counts = countsOf(day);
    const dayTotal = counts.reduce((sum, count) => sum + count, 0);
    return {
      day,
      label: capitalize(long.format(asDate(day))),
      short: short.format(asDate(day)),
      counts,
      total: dayTotal,
      level: dayTotal === 0 || busiest === 0 ? 0 : (Math.min(4, Math.ceil((dayTotal / busiest) * 4)) as 1 | 2 | 3 | 4),
      inPeriod: inRange(day, period),
      future: day > today,
    };
  };

  const monday = addDays(kept, -((asDate(kept).getUTCDay() + 6) % 7));
  const weeks: (ConsumptionDayView | null)[][] = [];
  const months: { week: number; label: string }[] = [];
  for (let start = monday, week = 0; start <= today; start = addDays(start, 7), week++) {
    const column = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    weeks.push(column.map((day) => (day >= kept && day <= today ? dayView(day) : null)));
    const starting = column.find((day) => day.endsWith("-01") && day >= kept);
    if (starting) months.push({ week, label: monthShort.format(asDate(starting)) });
  }
  // The first column names its month too, unless the next month's name comes within two columns.
  if (!months.some((month) => month.week <= 2)) months.unshift({ week: 0, label: monthShort.format(asDate(kept)) });
  const weekdays = Array.from({ length: 7 }, (_, index) => (index % 2 === 0 && index < 5 ? weekday.format(asDate(addDays(monday, index))) : ""));

  const bars = Array.from({ length: period.length }, (_, index) => dayView(addDays(period.first, index)));

  return {
    periodLabel,
    free: period.free,
    total,
    totalText: t("billing.consumption.actions", { count: total, number: number.format(total) }),
    totalNumber: number.format(total),
    totalUnit: t("billing.consumption.actionsUnit", { count: total }),
    change,
    progress,
    tools,
    series,
    grid: { weeks, months, weekdays },
    bars: { days: bars, max: Math.max(0, ...bars.map((bar) => bar.total)) },
  };
}
