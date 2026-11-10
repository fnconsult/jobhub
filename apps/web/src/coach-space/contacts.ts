import type { Queryable } from "../database/pool";
import { parseMeeting, type Meeting } from "./meeting";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Session contacts override the coach's permanent contact. All contact writes recheck ownership. */
export function coachContacts(database: Queryable) {
  return {
    async ofCoach(coachId: string): Promise<Meeting | null> {
      if (!UUID.test(coachId)) return null;
      const { rows } = await database.query<{ contact: Meeting }>(
        "SELECT c.contact FROM coach_meeting_contact c JOIN human_coach h ON h.id=c.coach_id AND h.retired_at IS NULL WHERE c.coach_id=$1",
        [coachId],
      );
      return rows[0]?.contact ?? null;
    },
    async forCandidate(candidateId: string): Promise<Record<string, Meeting | null>> {
      const { rows } = await database.query<{ id: string; sessionContact: Meeting | null; coachContact: Meeting | null; videoLink: string | null }>(
        `SELECT s.id, sc.contact AS "sessionContact",hc.contact AS "coachContact",s.video_link AS "videoLink"
        FROM coaching_session s LEFT JOIN coaching_session_contact sc ON sc.session_id=s.id LEFT JOIN coach_meeting_contact hc ON hc.coach_id=s.coach_id
        WHERE s.candidate_id=$1 AND s.withdrawn_at IS NULL`,
        [candidateId],
      );
      return Object.fromEntries(
        rows.map((row) => [
          row.id,
          parseMeeting(row.sessionContact) ?? parseMeeting({ kind: "video", target: row.videoLink }) ?? parseMeeting(row.coachContact),
        ]),
      );
    },
    async ofSession(coachId: string, sessionId: string): Promise<Meeting | null> {
      if (!UUID.test(coachId) || !UUID.test(sessionId)) return null;
      const { rows } = await database.query<{ sessionContact: Meeting | null; coachContact: Meeting | null; videoLink: string | null }>(
        `SELECT sc.contact AS "sessionContact",hc.contact AS "coachContact",s.video_link AS "videoLink" FROM coaching_session s
        JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL
        LEFT JOIN coaching_session_contact sc ON sc.session_id=s.id LEFT JOIN coach_meeting_contact hc ON hc.coach_id=h.id
        WHERE s.id=$2 AND s.coach_id=$1 AND s.withdrawn_at IS NULL`,
        [coachId, sessionId],
      );
      return rows[0]
        ? (parseMeeting(rows[0].sessionContact) ?? parseMeeting({ kind: "video", target: rows[0].videoLink }) ?? parseMeeting(rows[0].coachContact))
        : null;
    },
    async save(coachId: string, sessionId: string | null, value: unknown): Promise<boolean> {
      if (!UUID.test(coachId) || (sessionId !== null && (typeof sessionId !== "string" || !UUID.test(sessionId)))) return false;
      const meeting = parseMeeting(value);
      if (!meeting) return false;
      const result = sessionId
        ? await database.query(
            `INSERT INTO coaching_session_contact (session_id,contact)
        SELECT s.id,$3::jsonb FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL
        WHERE s.coach_id=$1 AND s.id=$2 AND s.withdrawn_at IS NULL
        ON CONFLICT (session_id) DO UPDATE SET contact=EXCLUDED.contact`,
            [coachId, sessionId, JSON.stringify(meeting)],
          )
        : await database.query(
            `INSERT INTO coach_meeting_contact (coach_id,contact) SELECT id,$2::jsonb FROM human_coach WHERE id=$1 AND retired_at IS NULL
          ON CONFLICT (coach_id) DO UPDATE SET contact=EXCLUDED.contact`,
            [coachId, JSON.stringify(meeting)],
          );
      return result.rowCount === 1;
    },
  };
}
export async function migrateCoachContacts(database: Queryable) {
  await database.query(`CREATE TABLE IF NOT EXISTS coach_meeting_contact (coach_id uuid PRIMARY KEY REFERENCES human_coach(id),contact jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS coaching_session_contact (session_id uuid PRIMARY KEY REFERENCES coaching_session(id) ON DELETE CASCADE,contact jsonb NOT NULL);`);
}
