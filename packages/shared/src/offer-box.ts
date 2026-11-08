/**
 * The Offer box's rules (« Offres à traiter », ADR-0090), shared by the web page and the app's screen so the two lay
 * the same read out the same way: Importance tiers, « Aujourd'hui » then « Précédemment », « Plus tard », « Expirées sans
 * décision », « Écartées », the source chips and their counts, and how old a posting is; and the two date rules the
 * server keeps (#817): until when « Plus tard » lasts, and when an entry left undecided expires.
 *
 *   const view = offerBoxView(read, "email");   // GET /api/offer-box, filtered by the « Email » chip
 *   view.today.tiers;                           // [{ tier: "not_to_miss", entries }, …], empty tiers left out
 *   view.earlier.tiers[0].entries;              // what « Tout écarter (n) » écarte for that tier
 *   postingAge(entry.jobOffer…, read.today);    // « publiée il y a 24 j · sort dans 6 j »
 *   nextMondayInParis(now);                     // « Plus tard »: back on Monday 00:00 Paris time
 *
 * Rules only, no AI: the Match Score is the one the read gives.
 */
import { MAX_POSTING_AGE_DAYS } from "./posting-date";
import { ARRIVAL_SOURCES, type ArrivalSource, type OfferBoxEntryRead, type OfferBoxResponse } from "./reads";

export { ARRIVAL_SOURCES, type ArrivalSource } from "./reads";

/** « À ne pas manquer » (80 and more), « À regarder » (60 to 79), « Peu adaptées » (under 60, or not computable). */
export const IMPORTANCE_TIERS = ["not_to_miss", "to_look_at", "less_suited"] as const;
export type ImportanceTier = (typeof IMPORTANCE_TIERS)[number];

/** The lowest Match Score of « À ne pas manquer », then of « À regarder ». */
const NOT_TO_MISS = 80;
const TO_LOOK_AT = 60;

/** An entry's Importance tier, from its Match Score (null: not computable). */
export function importanceTier(matchScore: number | null): ImportanceTier {
  if (matchScore === null || matchScore < TO_LOOK_AT) return "less_suited";
  return matchScore >= NOT_TO_MISS ? "not_to_miss" : "to_look_at";
}

/** A source chip: every source (« Toutes ») or one. */
export type OfferBoxFilter = ArrivalSource | "all";

/** « sort dans n j » is shown in a posting's last days. */
const LEAVING_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** Whole days from the day `instant` falls on in French time to `today` ("2026-11-05"). */
function daysBefore(instant: string | Date, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${PARIS_DAY.format(new Date(instant))}T00:00:00Z`)) / DAY_MS);
}

/** The day `instant` falls on in French time ("2026-11-09"). */
export const parisDay = (instant: string | Date): string => PARIS_DAY.format(new Date(instant));

/** The instant `day` ("2026-11-09") starts in French time: 00:00 at UTC+1 in winter, UTC+2 in summer. */
function parisMidnight(day: string): Date {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  for (const hours of [1, 2]) {
    const instant = new Date(utcMidnight - hours * 60 * 60 * 1000);
    if (parisDay(instant) === day && parisDay(new Date(instant.getTime() - 1)) !== day) return instant;
  }
  throw new Error(`No midnight in Paris on ${day}`);
}

/**
 * Until when « Plus tard » puts an entry out of sight (ADR-0090): the next Monday 00:00 Paris time, a week on when it is
 * Monday already in Paris. No date to pick.
 */
export function nextMondayInParis(now: Date): Date {
  const today = Date.parse(`${parisDay(now)}T00:00:00Z`);
  const weekday = new Date(today).getUTCDay(); // 0 is Sunday, 1 Monday
  const ahead = (8 - weekday) % 7 || 7;
  return parisMidnight(new Date(today + ahead * DAY_MS).toISOString().slice(0, 10));
}

/**
 * Whether an entry left undecided is « Expirée sans décision » on `today` (ADR-0090): its Posting date, or its first
 * Arrival when that is unknown, passed MAX_POSTING_AGE_DAYS French days ago. It then leaves the count; it is never
 * écartée for the Candidate.
 */
export function isExpiredWithoutDecision({ postedAt, firstArrivalAt }: { postedAt: string | Date | null; firstArrivalAt: string | Date }, today: string): boolean {
  return daysBefore(postedAt ?? firstArrivalAt, today) > MAX_POSTING_AGE_DAYS;
}

/**
 * How old an entry's posting is on `today`, in French days: `postedDaysAgo` (« publiée il y a n j »), null when its
 * Posting date is unknown; `leavesInDays` (« sort dans n j ») in its last 7 days of MAX_POSTING_AGE_DAYS, counted from its
 * Posting date or, unknown, its first Arrival; null before.
 */
export function postingAge({ postedAt, firstArrivalAt }: { postedAt: string | null; firstArrivalAt: string }, today: string): { postedDaysAgo: number | null; leavesInDays: number | null } {
  const postedDaysAgo = postedAt === null ? null : Math.max(0, daysBefore(postedAt, today));
  const left = MAX_POSTING_AGE_DAYS - daysBefore(postedAt ?? firstArrivalAt, today);
  return { postedDaysAgo, leavesInDays: left >= 0 && left <= LEAVING_SOON_DAYS ? left : null };
}

/** The entries of one Importance tier, the most recent first Arrival first. */
export interface OfferBoxTier {
  tier: ImportanceTier;
  entries: OfferBoxEntryRead[];
}

/** « Aujourd'hui » or « Précédemment »: its entries à traiter by tier (empty tiers left out), and those already suivies. */
export interface OfferBoxDay {
  tiers: OfferBoxTier[];
  followed: OfferBoxEntryRead[];
}

export interface OfferBoxView {
  /** « N à traiter »: the whole box's, whatever the chip, « Plus tard » included. */
  toHandle: number;
  /** « k traitées »: the entries « Suivies » or « Écartées ». */
  treated: number;
  /** « n arrivées aujourd'hui » (#898): the whole box's entries whose day of Arrival is today, whatever the chip. */
  arrivedToday: number;
  /** « Toutes » then each source, with how many of its entries are still à traiter. */
  chips: { source: OfferBoxFilter; toHandle: number }[];
  /** « Aujourd'hui »: arrived today, or back today from « Plus tard ». */
  today: OfferBoxDay;
  /** « Précédemment »: each tier's entries are what its « Tout écarter (n) » écarte. */
  earlier: OfferBoxDay;
  /** « Plus tard », folded (#817): out of the days until their Monday, still à traiter; the soonest back first. */
  later: OfferBoxEntryRead[];
  /** « Expirées sans décision », folded (#817): out of the count, the most recent first Arrival first. */
  expired: OfferBoxEntryRead[];
  /** « Écartées », folded at the foot (#816): those the read gives (the last 30 days'), the latest écartée first. */
  dismissed: OfferBoxEntryRead[];
}

const newestFirst = (a: OfferBoxEntryRead, b: OfferBoxEntryRead) => Date.parse(b.firstArrivalAt) - Date.parse(a.firstArrivalAt);

function dayOf(entries: OfferBoxEntryRead[]): OfferBoxDay {
  const toHandle = entries.filter((entry) => entry.state === "to_handle").sort(newestFirst);
  return {
    tiers: IMPORTANCE_TIERS.map((tier) => ({ tier, entries: toHandle.filter((entry) => importanceTier(entry.matchScore) === tier) })).filter((tier) => tier.entries.length > 0),
    followed: entries.filter((entry) => entry.state === "followed").sort(newestFirst),
  };
}

/** The Offer box as the page and the app show it, filtered by a source chip (« Toutes » by default). */
export function offerBoxView(box: OfferBoxResponse, filter: OfferBoxFilter = "all"): OfferBoxView {
  const toHandle = box.entries.filter((entry) => entry.state === "to_handle" || entry.state === "later");
  const cameBy = (source: ArrivalSource) => (entry: OfferBoxEntryRead) => entry.sources.some((arrival) => arrival.source === source);
  const shown = filter === "all" ? box.entries : box.entries.filter(cameBy(filter));
  // Back from « Plus tard » on its Monday, an entry is under « Aujourd'hui » that day.
  const isToday = (entry: OfferBoxEntryRead) => entry.arrivalDay === box.today || (entry.state === "to_handle" && entry.laterUntil !== null && parisDay(entry.laterUntil) === box.today);
  return {
    toHandle: toHandle.length,
    treated: box.entries.filter((entry) => entry.state === "followed" || entry.state === "dismissed").length,
    arrivedToday: box.entries.filter((entry) => entry.arrivalDay === box.today).length,
    chips: [{ source: "all", toHandle: toHandle.length }, ...ARRIVAL_SOURCES.map((source) => ({ source, toHandle: toHandle.filter(cameBy(source)).length }))],
    today: dayOf(shown.filter(isToday)),
    earlier: dayOf(shown.filter((entry) => !isToday(entry))),
    later: shown.filter((entry) => entry.state === "later").sort((a, b) => Date.parse(a.laterUntil ?? "") - Date.parse(b.laterUntil ?? "") || newestFirst(a, b)),
    expired: shown.filter((entry) => entry.state === "expired").sort(newestFirst),
    dismissed: shown.filter((entry) => entry.state === "dismissed").sort((a, b) => Date.parse(b.dismissedAt ?? "") - Date.parse(a.dismissedAt ?? "")),
  };
}
