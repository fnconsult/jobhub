/**
 * Forgetting what Guests captured (ADR-0003). Kept free of the web app's other
 * modules so the worker, which runs the clean-up on a schedule, can import it.
 */
import { GUEST_RETENTION_HOURS } from "@jobhub/shared";
import type { Pool } from "pg";

/** When a Job Offer captured now by a Guest, and by no Candidate, must be forgotten (SQL). */
export const GUEST_EXPIRY_SQL = `now() + make_interval(hours => ${GUEST_RETENTION_HOURS})`;

/**
 * Deletes the Job Offers that only Guests captured and whose retention has run
 * out by `now`. A Job Offer a Candidate captured is never deleted here.
 * Returns how many were deleted.
 */
export async function forgetExpiredGuestCaptures(database: Pick<Pool, "query">, now: Date = new Date()): Promise<number> {
  const { rowCount } = await database.query(`DELETE FROM job_offer WHERE guest_expires_at <= $1`, [now]);
  return rowCount ?? 0;
}
