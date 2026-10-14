/**
 * Scheduling and recording the worker's re-checks of Job Offer sources, which
 * find Expired Job Offers. Kept free of the web app's other modules so the
 * worker can import it: it only reads the Application table, to re-check the
 * Job Offers Candidates are still applying to.
 */
import { FINAL_APPLICATION_STATUSES } from "@jobhub/shared";
import type { Pool } from "pg";

/** How often a Job Offer's source is re-checked, in days. */
export const RECHECK_INTERVAL_DAYS = 3;
/**
 * How often an Expired Job Offer's source is re-checked, in days. Expiry is
 * read from the page, and a page can be misread: re-checking now and then lets
 * a Job Offer still published heal back.
 */
export const EXPIRED_RECHECK_INTERVAL_DAYS = 14;

/**
 * What one re-check learnt: the source still publishes the posting, no longer
 * does ("gone"), or nothing (its source could not be read).
 */
export type SourceCheckOutcome = "published" | "gone" | "unknown";

/** Gone checks in a row that make a Job Offer an Expired Job Offer: one alone may be a hiccup of the site. */
export const GONE_CHECKS_TO_EXPIRE = 2;

export interface SourceChecks {
  /**
   * Up to `limit` Job Offers whose source is due a re-check at `now`, longest
   * unchecked first: those with a source URL that at least one ongoing
   * Application follows (one not at a FINAL_APPLICATION_STATUSES), captured or
   * last re-checked at least RECHECK_INTERVAL_DAYS ago
   * (EXPIRED_RECHECK_INTERVAL_DAYS once expired). Never the whole stock.
   */
  dueForRecheck(now: Date, limit: number): Promise<{ id: string; sourceUrl: string }[]>;
  /**
   * Records a re-check made at `now`. GONE_CHECKS_TO_EXPIRE "gone" in a row make
   * it an Expired Job Offer (as of the check that confirmed it, a date kept while
   * it stays gone); "published" resets the count and makes it a published one
   * again; "unknown" changes nothing. Says whether it is now expired.
   */
  record(id: string, outcome: SourceCheckOutcome, now: Date): Promise<{ expired: boolean }>;
}

const FINAL_STATUSES_SQL = FINAL_APPLICATION_STATUSES.map((status) => `'${status}'`).join(", ");

export function createSourceChecks(database: Pick<Pool, "query">): SourceChecks {
  return {
    async dueForRecheck(now, limit) {
      const { rows } = await database.query<{ id: string; source_url: string }>(
        `SELECT o.id, o.source_url FROM job_offer o
          WHERE o.source_url IS NOT NULL
            AND EXISTS (SELECT 1 FROM application a WHERE a.job_offer_id = o.id AND a.status NOT IN (${FINAL_STATUSES_SQL}))
            -- In hours, not days: timestamptz minus a days interval counts calendar days in the
            -- session's time zone, 71 or 73 hours across a daylight saving change.
            AND COALESCE(o.source_checked_at, o.created_at) <= $1::timestamptz - make_interval(hours =>
                  24 * CASE WHEN o.expired_at IS NULL THEN ${RECHECK_INTERVAL_DAYS} ELSE ${EXPIRED_RECHECK_INTERVAL_DAYS} END)
          ORDER BY COALESCE(o.source_checked_at, o.created_at), o.id
          LIMIT $2`,
        [now, limit],
      );
      return rows.map((row) => ({ id: row.id, sourceUrl: row.source_url }));
    },

    async record(id, outcome, now) {
      // The right-hand sides read the row as it was before this check.
      const { rows } = await database.query<{ expired: boolean }>(
        `UPDATE job_offer
            SET source_checked_at = $2,
                gone_checks = CASE $3 WHEN 'gone' THEN gone_checks + 1 WHEN 'published' THEN 0 ELSE gone_checks END,
                expired_at = CASE
                  WHEN $3 = 'gone' AND gone_checks + 1 >= ${GONE_CHECKS_TO_EXPIRE} THEN COALESCE(expired_at, $2)
                  WHEN $3 = 'published' THEN NULL
                  ELSE expired_at END
          WHERE id = $1
          RETURNING expired_at IS NOT NULL AS expired`,
        [id, now, outcome],
      );
      return { expired: rows[0]?.expired ?? false };
    },
  };
}
