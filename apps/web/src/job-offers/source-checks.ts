/**
 * Scheduling and recording the worker's re-checks of Job Offer sources, which
 * find Expired Job Offers. Kept free of the web app's other modules so the
 * worker can import it.
 */
import type { Pool } from "pg";

/** How often a Job Offer's source is re-checked, in days. */
export const RECHECK_INTERVAL_DAYS = 3;
/**
 * How often an Expired Job Offer's source is re-checked, in days. Expiry is
 * read from the page, and a page can be misread: re-checking now and then lets
 * a Job Offer still published heal back.
 */
export const EXPIRED_RECHECK_INTERVAL_DAYS = 14;

/** What a re-check learnt: still published, no longer published, or nothing (its source could not be read). */
export type SourceCheckOutcome = "published" | "expired" | "unknown";

export interface SourceChecks {
  /**
   * Up to `limit` Job Offers whose source is due a re-check at `now`, longest
   * unchecked first: those with a source URL, captured or last re-checked at
   * least RECHECK_INTERVAL_DAYS ago (EXPIRED_RECHECK_INTERVAL_DAYS once
   * expired), and kept by a Candidate (what only Guests captured is forgotten
   * within a day anyway).
   */
  dueForRecheck(now: Date, limit: number): Promise<{ id: string; sourceUrl: string }[]>;
  /**
   * Records a re-check made at `now`. "expired" makes it an Expired Job Offer
   * (keeping the date it was first found so); "published" makes it a published
   * one again; "unknown" changes neither.
   */
  record(id: string, outcome: SourceCheckOutcome, now: Date): Promise<void>;
}

export function createSourceChecks(database: Pick<Pool, "query">): SourceChecks {
  return {
    async dueForRecheck(now, limit) {
      const { rows } = await database.query<{ id: string; source_url: string }>(
        `SELECT id, source_url FROM job_offer
          WHERE source_url IS NOT NULL AND guest_expires_at IS NULL
            AND COALESCE(source_checked_at, created_at) <= $1::timestamptz - make_interval(days =>
                  CASE WHEN expired_at IS NULL THEN ${RECHECK_INTERVAL_DAYS} ELSE ${EXPIRED_RECHECK_INTERVAL_DAYS} END)
          ORDER BY COALESCE(source_checked_at, created_at), id
          LIMIT $2`,
        [now, limit],
      );
      return rows.map((row) => ({ id: row.id, sourceUrl: row.source_url }));
    },

    async record(id, outcome, now) {
      await database.query(
        `UPDATE job_offer
            SET source_checked_at = $2,
                expired_at = CASE $3 WHEN 'expired' THEN COALESCE(expired_at, $2) WHEN 'published' THEN NULL ELSE expired_at END
          WHERE id = $1`,
        [id, now, outcome],
      );
    },
  };
}
