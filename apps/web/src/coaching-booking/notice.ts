import type { Queryable } from "../database/pool";
import type { PushNotification } from "../push-notifications";
export async function bookingChanged(
  database: Queryable,
  push: { notify(id: string, event: PushNotification, options: { once: string }): Promise<unknown> },
  sessionId: string,
  eventKey: string,
) {
  const session = (
    await database.query<{ candidateId: string; coachAccount: string | null }>(
      `SELECT s.candidate_id AS "candidateId",c.id AS "coachAccount" FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL LEFT JOIN candidate c ON lower(c.email)=h.email AND c."emailVerified" WHERE s.id=$1 AND s.withdrawn_at IS NULL AND s.cancelled_at IS NULL`,
      [sessionId],
    )
  ).rows[0];
  if (!session) return;
  await push.notify(session.candidateId, { event: "coaching_session_changed" }, { once: `cal:${eventKey}:candidate` });
  if (session.coachAccount) await push.notify(session.coachAccount, { event: "coaching_session_changed_by_candidate" }, { once: `cal:${eventKey}:coach` });
}
