/**
 * Posting date (CONTEXT.md): when a Job Offer was first published, as its
 * source states it. Job discovery keeps a posting dated within the last
 * MAX_POSTING_AGE_DAYS, drops one dated longer ago, and keeps an undated one,
 * which ranks below a dated one with an equal Match Score.
 *
 *   const postedAt = believablePostingDate(parseStatedDate(jsonLd.datePosted), now);
 *   if (isPostingTooOld(postedAt, now)) skip("too_old");
 *   const shown = rankByMatchScore(scoredJobOffers);
 */

/** A posting first published longer ago than this is dropped. */
export const MAX_POSTING_AGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
/** The earliest Posting date taken seriously; the Job Offers store refuses earlier ones too. */
const EARLIEST = Date.UTC(2000, 0, 1);

/**
 * The instant a source states, in any of the forms sources use: epoch
 * milliseconds (Lever), an ISO 8601 date (UTC midnight) or date-time (UTC when
 * it has no offset: Brave), or an RFC 1123 date (Tavily). Undefined otherwise.
 */
export function parseStatedDate(value: unknown): Date | undefined {
  let instant = NaN;
  if (typeof value === "number") instant = value;
  else if (typeof value === "string") {
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) instant = Date.parse(`${text}T00:00:00Z`);
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) instant = Date.parse(`${text}Z`);
    else if (/^\d{4}-\d{2}-\d{2}T/.test(text) || /^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}(:\d{2})? (GMT|UTC|[+-]\d{4})$/.test(text)) {
      instant = Date.parse(text);
    }
  }
  return Number.isFinite(instant) ? new Date(instant) : undefined;
}

/** The date, when it can be a Posting date at `now`: not before 2000, not in the future (a day of clock skew allowed). */
export function believablePostingDate(date: Date | undefined, now: Date): Date | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.getTime() >= EARLIEST && date.getTime() <= now.getTime() + DAY_MS ? date : undefined;
}

/** Whether a posting first published at `postedAt` is more than MAX_POSTING_AGE_DAYS old at `now`. Undated: never. */
export function isPostingTooOld(postedAt: Date | undefined, now: Date): boolean {
  return postedAt !== undefined && now.getTime() - postedAt.getTime() > MAX_POSTING_AGE_DAYS * DAY_MS;
}

/** A Job Offer as Job Search results and Job Digests list it: with its Match Score. */
interface Ranked {
  jobOffer: { postedAt?: Date };
  matchScore: { score: number };
}

/**
 * The results, best Match Score first; at an equal Match Score, a Job Offer
 * with a Posting date before an undated one. Otherwise in the order given.
 */
export function rankByMatchScore<T extends Ranked>(results: readonly T[]): T[] {
  const undated = (result: T) => (result.jobOffer.postedAt ? 0 : 1);
  return [...results].sort((a, b) => b.matchScore.score - a.matchScore.score || undated(a) - undated(b));
}
