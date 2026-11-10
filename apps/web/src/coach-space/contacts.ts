import { inTransaction, type Queryable } from "../database/pool";
import type { Pool } from "pg";
import { parseMeeting, type Meeting } from "./meeting";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Session contacts override the coach's permanent contact. All contact writes recheck ownership. */
export function coachContacts(database: Pool) {
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
      if (sessionId)
        return inTransaction(database, async (within) => {
          // Both models move together: old clients see the same video link, while phone contacts clear it.
          const changed = await within.query(
            `UPDATE coaching_session s SET video_link=$3 FROM human_coach h WHERE s.coach_id=$1 AND s.id=$2 AND s.withdrawn_at IS NULL AND h.id=s.coach_id AND h.retired_at IS NULL RETURNING s.id`,
            [coachId, sessionId, meeting.kind === "video" ? meeting.target : null],
          );
          if (!changed.rowCount) return false;
          await within.query(
            `INSERT INTO coaching_session_contact(session_id,contact) VALUES($1,$2::jsonb) ON CONFLICT(session_id) DO UPDATE SET contact=EXCLUDED.contact`,
            [sessionId, JSON.stringify(meeting)],
          );
          return true;
        });
      const result = await database.query(
        `INSERT INTO coach_meeting_contact(coach_id,contact) SELECT id,$2::jsonb FROM human_coach WHERE id=$1 AND retired_at IS NULL ON CONFLICT(coach_id) DO UPDATE SET contact=EXCLUDED.contact`,
        [coachId, JSON.stringify(meeting)],
      );
      return result.rowCount === 1;
    },
  };
}
export async function migrateCoachContacts(database: Queryable) {
  await database.query(`CREATE TABLE IF NOT EXISTS coach_meeting_contact (coach_id uuid PRIMARY KEY REFERENCES human_coach(id),contact jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS coaching_session_contact (session_id uuid PRIMARY KEY REFERENCES coaching_session(id) ON DELETE CASCADE,contact jsonb NOT NULL);
    -- The legacy/native date editor still writes video_link. A changed link retires its older v2 override atomically.
    CREATE OR REPLACE FUNCTION retire_session_contact_on_link_change() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN DELETE FROM coaching_session_contact WHERE session_id=NEW.id; RETURN NEW; END $$;
    DROP TRIGGER IF EXISTS coaching_session_link_changed ON coaching_session;
    CREATE TRIGGER coaching_session_link_changed AFTER UPDATE OF video_link ON coaching_session
      FOR EACH ROW WHEN (OLD.video_link IS DISTINCT FROM NEW.video_link) EXECUTE FUNCTION retire_session_contact_on_link_change();`);
}
