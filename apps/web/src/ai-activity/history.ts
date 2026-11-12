/**
 * The history of an Activity (CONTEXT.md « Activité entry », ADR-0086, #808): under « En ce moment », the page's Activité
 * entries (entries.ts), newest first, by day (« Aujourd'hui », « Le 27/10 »); each with its cost as the Candidate reads it,
 * never in euros; and at the foot, « Sources et outils de cette page », each Provenance site and Tool once.
 *
 *   historyByDay(entries, now, timeZone?)        the days, today first, an entry of unknown time last
 *   costShown(entry, usage)                      its Plan Quota with the week's use, « compté dans votre consommation », its tokens, « Sans IA »
 *   entryToOpen(entries, { messageId, card? })   the entry « Dans l'activité » opens, under a reply or one of its cards
 *   pageSummary(entries)                         AI Activity's button's words: « 3 modèles · 10,9k tokens »
 *
 * Pure. Activity counts nothing itself: the week's use is the Usage Meter's (ADR-0032), what Votre consommation counts
 * is its own (ADR-0091).
 */
import type { WeeklyQuota } from "@jobhub/shared";
import type { ActivityEntry, EntryCost } from "./entries";

/** One day of the history: its entries in the page's order; `at` the first one's time, to word the day. */
export interface HistoryDay {
  /** The day in the Candidate's time zone, « 2026-10-27 »; « undated » for entries whose time is not known. */
  key: string;
  today: boolean;
  at: string | null;
  entries: ActivityEntry[];
}

const UNDATED = "undated";

/** The day of `at` in `timeZone` (the browser's when not given), as « 2026-10-27 ». */
function dayOf(at: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(at);
}

/** The entries by day, in their order (newest first): today's first, those whose time is not known last. */
export function historyByDay(entries: readonly ActivityEntry[], now: Date, timeZone?: string): HistoryDay[] {
  const today = dayOf(now, timeZone);
  const days = new Map<string, HistoryDay>();
  for (const entry of entries) {
    const key = entry.at ? dayOf(new Date(entry.at), timeZone) : UNDATED;
    const day = days.get(key) ?? { key, today: key === today, at: entry.at, entries: [] };
    day.entries.push(entry);
    days.set(key, day);
  }
  const undated = days.get(UNDATED);
  days.delete(UNDATED);
  return [...days.values(), ...(undated ? [undated] : [])];
}

/** A weekly Plan Quota as the Usage Meter reads it: what was used this week, of a limit (null: unlimited). */
export type QuotaUse = { quota: WeeklyQuota; used: number; limit: number | null };

/**
 * An entry's cost as the Candidate reads it: the Plan Quota it used, with the week's use when the Plan limits it
 * (« 1 recherche du forfait · 4 sur 7 cette semaine »); for AI without a Plan Quota, that Votre consommation counts it;
 * its tokens; or that it was made without AI. All but « Sans IA » link to `/abonnement#consommation`.
 */
export interface CostShown {
  quota: { quota: WeeklyQuota; week: { used: number; limit: number } | null } | null;
  consumption: boolean;
  tokens: EntryCost["tokens"];
  noAi: boolean;
  /** Offered (ADR-0106): « Offerte, hors forfait », no Plan Quota and not in « Votre consommation ». */
  offered?: true;
}

export function costShown(entry: Pick<ActivityEntry, "cost" | "unrecorded">, usage: readonly QuotaUse[] | null): CostShown {
  const { quota, tokens, noAi, offered } = entry.cost;
  const use = quota ? usage?.find((each) => each.quota === quota) : undefined;
  const week = use && use.limit !== null && use.limit > 0 ? { used: use.used, limit: use.limit } : null;
  return {
    quota: quota ? { quota, week } : null,
    consumption: !quota && !noAi && !offered && !entry.unrecorded,
    tokens,
    noAi,
    ...(offered ? { offered } : {}),
  };
}

/**
 * The entry « Dans l'activité » opens: under an AI Coach reply (`messageId`), its entry; under its card at `card` (its
 * place under the reply), the entry the card led to once applied, else the reply's. Null when the page has no entry of it.
 */
export function entryToOpen(entries: readonly ActivityEntry[], target: { messageId: string; card?: number }): string | null {
  const reply = entries.find((entry) => entry.kind === "coach_reply" && entry.messageId === target.messageId);
  if (!reply) return null;
  const led = target.card === undefined ? null : (reply.proposals?.[target.card]?.led ?? null);
  return led ?? reply.key;
}

/** What AI Activity's button says of the page (#369, #809): how many models served it, and its entries' tokens. */
export type PageSummary = { models: number; tokens: number | null };

/**
 * AI Activity's words in the Top Bar: the models of the page's entries, each named once, and their tokens summed (null
 * when none were kept); null on a page where no model served (none recorded, or Jobbbox's rules alone), which has none.
 */
export function pageSummary(entries: readonly ActivityEntry[]): PageSummary | null {
  const models = new Set(entries.flatMap((entry) => entry.models.map((model) => model.name)));
  if (models.size === 0) return null;
  const tokens = entries.reduce<number | null>((sum, entry) => (entry.cost.tokens ? (sum ?? 0) + entry.cost.tokens.count : sum), null);
  return { models: models.size, tokens };
}
