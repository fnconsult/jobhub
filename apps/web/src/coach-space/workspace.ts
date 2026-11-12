/** The Coach space's private workspace. Every read/write rechecks active coach and the relationship. */
import type { Pool } from "pg";
import { nameForCoach } from "../candidate-identity/names";
import type { HumanCoaches } from "../human-coaches";
import { coachingDay, COACHING_DEFAULT_ZONE } from "@jobhub/shared/coaching-time";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = "EXISTS (SELECT 1 FROM human_coach h WHERE h.id = $1 AND h.retired_at IS NULL)";
const RELATIONSHIP = `(${ACTIVE} AND (EXISTS (SELECT 1 FROM coach_access a WHERE a.coach_id = $1 AND a.candidate_id = $2)
  OR EXISTS (SELECT 1 FROM coaching_session s WHERE s.coach_id = $1 AND s.candidate_id = $2 AND s.withdrawn_at IS NULL AND s.cancelled_at IS NULL)))`;
interface CandidateRow {
  id: string;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  preferredName: string | null;
  access: boolean;
  recentAt: Date | null;
}
export interface PrivateNote {
  text: string;
  revision: number;
  updatedAt: Date | null;
}
export type NoteSaved = { ok: true; note: PrivateNote } | { ok: false; error: "not_found" | "invalid" | "conflict" };
const EMPTY_NOTE: PrivateNote = { text: "", revision: 0, updatedAt: null };

export function sessionPhase(session: { scheduledAt: Date | null; durationMinutes: number | null }, now: Date): "before" | "during" | "after" {
  if (!session.scheduledAt || +now < +session.scheduledAt - 600_000) return "before";
  return +now <= +session.scheduledAt + (session.durationMinutes ?? 60) * 60_000 ? "during" : "after";
}

export function coachWorkspace(database: Pool, coaches: Pick<HumanCoaches, "coachSessions" | "candidateFile">) {
  async function candidates(coachId: string) {
    if (!UUID.test(coachId)) return [];
    const { rows } = await database.query<CandidateRow>(
      `
      SELECT c.id, c.name, c.given_name AS "givenName", c.family_name AS "familyName", c.preferred_name AS "preferredName",
        EXISTS (SELECT 1 FROM coach_access a WHERE a.coach_id=$1 AND a.candidate_id=c.id) AS access,
        greatest((SELECT max(s.scheduled_at) FROM coaching_session s WHERE s.coach_id=$1 AND s.candidate_id=c.id AND s.withdrawn_at IS NULL AND s.cancelled_at IS NULL AND s.scheduled_at <= now()),
                 (SELECT a.granted_at FROM coach_access a WHERE a.coach_id=$1 AND a.candidate_id=c.id)) AS "recentAt"
      FROM candidate c WHERE ${ACTIVE} AND (
        EXISTS (SELECT 1 FROM coach_access a WHERE a.coach_id=$1 AND a.candidate_id=c.id) OR
        EXISTS (SELECT 1 FROM coaching_session s WHERE s.coach_id=$1 AND s.candidate_id=c.id AND s.withdrawn_at IS NULL AND s.cancelled_at IS NULL))
      ORDER BY "recentAt" DESC NULLS LAST, c.id`,
      [coachId],
    );
    return rows.map((row) => ({ id: row.id, ...nameForCoach(row, row.access ? "full" : "short"), access: row.access, recentAt: row.recentAt }));
  }
  async function sessions(coachId: string) {
    if (!UUID.test(coachId)) return [];
    const [items, { rows }] = await Promise.all([
      coaches.coachSessions(coachId),
      database.query<{ id: string; candidateId: string; changedBy: string | null }>(
        `SELECT s.id, s.candidate_id AS "candidateId", s.changed_by AS "changedBy" FROM coaching_session s WHERE s.coach_id=$1 AND s.withdrawn_at IS NULL AND s.cancelled_at IS NULL AND ${ACTIVE}`,
        [coachId],
      ),
    ]);
    const extra = new Map(rows.map((row) => [row.id, row]));
    return items.flatMap((item) => {
      const row = extra.get(item.id);
      return row ? [{ ...item, candidateId: row.candidateId, changedBy: row.changedBy }] : [];
    });
  }
  async function note(coachId: string, candidateId: string, sessionId: string | null = null): Promise<PrivateNote | null> {
    if (!UUID.test(coachId) || (sessionId !== null && (typeof sessionId !== "string" || !UUID.test(sessionId)))) return null;
    const { rows } = await database.query<{ allowed: boolean; text: string | null; revision: number | null; updatedAt: Date | null }>(
      `
      SELECT ${RELATIONSHIP} AS allowed, n.text, n.revision, n.updated_at AS "updatedAt"
      FROM (SELECT 1) seed LEFT JOIN private_coach_note n ON n.coach_id=$1 AND n.candidate_id=$2 AND n.session_id IS NOT DISTINCT FROM $3::uuid
      WHERE $3::uuid IS NULL OR EXISTS (SELECT 1 FROM coaching_session s WHERE s.id=$3 AND s.coach_id=$1 AND s.candidate_id=$2 AND s.withdrawn_at IS NULL AND s.cancelled_at IS NULL)`,
      [coachId, candidateId, sessionId],
    );
    const row = rows[0];
    return row?.allowed ? { text: row.text ?? "", revision: row.revision ?? 0, updatedAt: row.updatedAt } : null;
  }
  return {
    candidates,
    sessions,
    note,
    async candidate(coachId: string, candidateId: string) {
      const person = (await candidates(coachId)).find((candidate) => candidate.id === candidateId);
      if (!person) return null;
      return {
        person,
        sessions: (await sessions(coachId)).filter((session) => session.candidateId === candidateId),
        note: (await note(coachId, candidateId)) ?? EMPTY_NOTE,
        file: person.access ? await coaches.candidateFile(coachId, candidateId) : null,
      };
    },
    async session(coachId: string, sessionId: string) {
      return (await sessions(coachId)).find((session) => session.id === sessionId) ?? null;
    },
    async today(coachId: string, now: Date, timeZone = COACHING_DEFAULT_ZONE) {
      const [all, people] = await Promise.all([sessions(coachId), candidates(coachId)]);
      const day = coachingDay(now, timeZone);
      const tomorrow = new Date(`${day}T12:00:00Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const next = tomorrow.toISOString().slice(0, 10);
      const dated = all.filter((session) => session.scheduledAt).sort((a, b) => +a.scheduledAt! - +b.scheduledAt!);
      return {
        today: dated.filter((session) => coachingDay(session.scheduledAt!, timeZone) === day),
        tomorrow: dated.filter((session) => coachingDay(session.scheduledAt!, timeZone) === next),
        toSchedule: all.filter((session) => !session.scheduledAt),
        toConfirm: all.filter(
          (session) => session.scheduledAt && +session.scheduledAt + (session.durationMinutes ?? 60) * 60_000 > +now && session.changedBy === "candidate",
        ),
        recent: people.filter((person) => person.recentAt && +person.recentAt <= +now).slice(0, 5),
      };
    },
    async saveNote(coachId: string, candidateId: string, sessionId: string | null, text: unknown, revision: unknown): Promise<NoteSaved> {
      if (typeof text !== "string" || text.length > 20_000 || !Number.isSafeInteger(revision) || Number(revision) < 0) return { ok: false, error: "invalid" };
      if (!(await note(coachId, candidateId, sessionId))) return { ok: false, error: "not_found" };
      const { rows } = await database.query<{ text: string; revision: number; updatedAt: Date }>(
        `
        INSERT INTO private_coach_note (coach_id,candidate_id,session_id,text,revision)
          SELECT $1,$2,$3,$4,1 WHERE $5=0 AND ${RELATIONSHIP}
        ON CONFLICT (coach_id,candidate_id,session_id) DO UPDATE SET text=EXCLUDED.text,revision=private_coach_note.revision+1,updated_at=clock_timestamp()
          WHERE private_coach_note.revision=$5 AND ${RELATIONSHIP}
        RETURNING text,revision,updated_at AS "updatedAt"`,
        [coachId, candidateId, sessionId, text, revision],
      );
      if (rows[0]) return { ok: true, note: rows[0] };
      // Existing notes need an UPDATE even when the caller's expected revision is positive.
      const updated = await database.query<{ text: string; revision: number; updatedAt: Date }>(
        `UPDATE private_coach_note SET text=$4,revision=revision+1,updated_at=clock_timestamp()
        WHERE coach_id=$1 AND candidate_id=$2 AND session_id IS NOT DISTINCT FROM $3::uuid AND revision=$5 AND ${RELATIONSHIP}
        RETURNING text,revision,updated_at AS "updatedAt"`,
        [coachId, candidateId, sessionId, text, revision],
      );
      return updated.rows[0] ? { ok: true, note: updated.rows[0] } : { ok: false, error: "conflict" };
    },
  };
}
export type WorkspaceSession = Awaited<ReturnType<ReturnType<typeof coachWorkspace>["sessions"]>>[number];

export async function migrateCoachWorkspace(database: Pool) {
  await database.query(`CREATE TABLE IF NOT EXISTS private_coach_note (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coach_id uuid NOT NULL REFERENCES human_coach(id),
    candidate_id text NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
    session_id uuid REFERENCES coaching_session(id) ON DELETE CASCADE,
    text text NOT NULL, revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE NULLS NOT DISTINCT (coach_id,candidate_id,session_id)
  )`);
}
