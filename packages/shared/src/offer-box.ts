/**
 * The Offer box's rules (« Offres à traiter », ADR-0090), shared by the web page and the app's screen so the two lay
 * the same read out the same way: Importance tiers, « Aujourd'hui » then « Précédemment », the source chips and their
 * counts, and how old a posting is.
 *
 *   const view = offerBoxView(read, "email");   // GET /api/offer-box, filtered by the « Email » chip
 *   view.today.tiers;                           // [{ tier: "not_to_miss", entries }, …], empty tiers left out
 *   postingAge(entry.jobOffer…, read.today);    // « publiée il y a 24 j · sort dans 6 j »
 *
 * Rules only, no AI: the Match Score is the one the read gives.
 */
import { MAX_POSTING_AGE_DAYS } from "./posting-date";
import { ARRIVAL_SOURCES, type ArrivalSource, type OfferBoxEntryRead, type OfferBoxResponse } from "./reads";

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
function daysBefore(instant: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${PARIS_DAY.format(new Date(instant))}T00:00:00Z`)) / DAY_MS);
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
  /** « N à traiter »: the whole box's, whatever the chip. */
  toHandle: number;
  /** « k traitées »: the entries « Suivies ». */
  treated: number;
  /** « Toutes » then each source, with how many of its entries are still à traiter. */
  chips: { source: OfferBoxFilter; toHandle: number }[];
  today: OfferBoxDay;
  earlier: OfferBoxDay;
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
  const toHandle = box.entries.filter((entry) => entry.state === "to_handle");
  const cameBy = (source: ArrivalSource) => (entry: OfferBoxEntryRead) => entry.sources.some((arrival) => arrival.source === source);
  const shown = filter === "all" ? box.entries : box.entries.filter(cameBy(filter));
  return {
    toHandle: toHandle.length,
    treated: box.entries.length - toHandle.length,
    chips: [{ source: "all", toHandle: toHandle.length }, ...ARRIVAL_SOURCES.map((source) => ({ source, toHandle: toHandle.filter(cameBy(source)).length }))],
    today: dayOf(shown.filter((entry) => entry.arrivalDay === box.today)),
    earlier: dayOf(shown.filter((entry) => entry.arrivalDay !== box.today)),
  };
}
