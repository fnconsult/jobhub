import { coachingSessionOver } from "@jobhub/shared/coaching-time";
import type { Queryable } from "../database/pool";
import type { RescheduledBy } from "../reschedules";

/**
 * « Espace coach v2 » off (main's rules, ADR-0107): whether `by` may change the session's date now. A Candidate
 * neither moves nor cancels a session that has ended, its start plus its duration (an hour when unknown), as when
 * the setting is on (#1019, #1022); its Human Coach still may, as before. "too_late" refuses it; the routes answer 409.
 */
export async function legacyMayChangeSession(within: Queryable, sessionId: string, by: RescheduledBy, now: Date): Promise<true | "too_late"> {
  if (by !== "candidate") return true;
  const session = (
    await within.query<{ scheduledAt: Date | null; durationMinutes: number | null }>(
      `SELECT scheduled_at AS "scheduledAt", duration_minutes AS "durationMinutes" FROM coaching_session WHERE id = $1`,
      [sessionId],
    )
  ).rows[0];
  return session && coachingSessionOver(session, now) ? "too_late" : true;
}
