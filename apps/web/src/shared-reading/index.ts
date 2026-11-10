/** Shared Reading (ADR-0097): one ephemeral document, only in a paid session's time window. */
import { z } from "zod";
import type { Pool } from "pg";
import type { MasterCvContent } from "@jobhub/shared";
import type { Queryable } from "../database/pool";
import { meetingWindow } from "@jobhub/shared/coaching-meeting";

export const SHARED_PDF_MAX_BYTES = 10 * 1024 * 1024;
export const sharedSourceSchema = z.object({ kind: z.enum(["profile", "tailored_cv", "cover_letter", "outreach_message"]), id: z.uuid() });
export type SharedSource = z.infer<typeof sharedSourceSchema>;
export type SharedDocument =
  | { kind: "cv"; title: string; content: MasterCvContent }
  | { kind: "text"; title: string; text: string }
  | { kind: "pdf"; title: string };
export type ReadingActor = { candidateId: string; coachId?: string | null };
export interface SharedReadingState {
  id: string;
  presenter: "candidate" | "coach";
  page: number;
  scroll: number;
  sequence: number;
  document: Pick<SharedDocument, "kind" | "title">;
}
export interface SharedReadingDeps {
  document(candidateId: string, source: SharedSource): Promise<SharedDocument | null>;
  now?: () => Date;
  validatePdf?(bytes: Uint8Array): Promise<boolean>;
}
interface Session {
  id: string;
  candidateId: string;
  coachId: string;
  scheduledAt: Date | null;
  durationMinutes: number | null;
  coachName: string;
}
interface ReadingRow {
  id: string;
  sessionId: string;
  presenter: "candidate" | "coach";
  page: number;
  scroll: number;
  sequence: number;
  payload: SharedDocument;
  pdf: Buffer | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_COLUMNS =
  's.id,s.candidate_id AS "candidateId",s.coach_id AS "coachId",s.scheduled_at AS "scheduledAt",s.duration_minutes AS "durationMinutes",h.name AS "coachName"';
const READING_COLUMNS = 'r.id,r.session_id AS "sessionId",r.presenter,r.page,r.scroll,r.sequence,r.payload,r.pdf';
export function sharedReading(database: Pool, deps: SharedReadingDeps) {
  const now = deps.now ?? (() => new Date());
  async function session(actor: ReadingActor, sessionId: string, withinWindow = true): Promise<Session | null> {
    if (!UUID.test(sessionId)) return null;
    const { rows } = await database.query<Session>(
      `SELECT ${SESSION_COLUMNS} FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL
      WHERE s.id=$1 AND s.withdrawn_at IS NULL AND (s.candidate_id=$2 OR s.coach_id=$3::uuid)`,
      [sessionId, actor.candidateId, actor.coachId ?? null],
    );
    const found = rows[0];
    return found && (!withinWindow || meetingWindow(found, now()) === "open") ? found : null;
  }
  async function active(
    actor: ReadingActor,
    sessionId: string,
    shareId?: string,
    includeDocument = false,
  ): Promise<{ session: Session; row: ReadingRow } | null> {
    await purgeExpiredSharedReading(database, now());
    if (!UUID.test(sessionId)) return null;
    const { rows } = await database.query<ReadingRow & Omit<Session, "id">>(
      `SELECT r.id,r.session_id AS "sessionId",r.presenter,r.page,r.scroll,r.sequence,${includeDocument ? "r.payload,r.pdf" : "jsonb_build_object('kind',r.payload->'kind','title',r.payload->'title') AS payload,NULL AS pdf"},s.candidate_id AS "candidateId",s.coach_id AS "coachId",s.scheduled_at AS "scheduledAt",s.duration_minutes AS "durationMinutes",h.name AS "coachName"
      FROM shared_reading r JOIN coaching_session s ON s.id=r.session_id JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL
      WHERE s.id=$1 AND ($2::uuid IS NULL OR r.id=$2) AND s.withdrawn_at IS NULL AND (s.candidate_id=$3 OR s.coach_id=$4::uuid)
      AND s.scheduled_at-interval '10 minutes'<=$5 AND s.scheduled_at+(coalesce(s.duration_minutes,60)+30)*interval '1 minute'>=$5`,
      [sessionId, shareId ?? null, actor.candidateId, actor.coachId ?? null, now()],
    );
    const row = rows[0];
    return row
      ? {
          session: {
            id: sessionId,
            candidateId: row.candidateId,
            coachId: row.coachId,
            scheduledAt: row.scheduledAt,
            durationMinutes: row.durationMinutes,
            coachName: row.coachName,
          },
          row,
        }
      : null;
  }

  async function start(
    found: Session,
    presenter: "candidate" | "coach",
    payload: SharedDocument,
    source: SharedSource | null,
    pdf: Uint8Array | null,
  ): Promise<SharedReadingState | null> {
    const { rows } = await database.query<ReadingRow>(
      `INSERT INTO shared_reading AS r (session_id,presenter,payload,source,pdf)
      SELECT s.id,$2,$3::jsonb,$4::jsonb,$5 FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL
      WHERE s.id=$1 AND s.candidate_id=$7 AND s.coach_id=$8 AND s.withdrawn_at IS NULL AND s.scheduled_at-interval '10 minutes'<=$6 AND s.scheduled_at+(coalesce(s.duration_minutes,60)+30)*interval '1 minute'>=$6
      ON CONFLICT (session_id) DO UPDATE SET id=gen_random_uuid(),presenter=EXCLUDED.presenter,payload=EXCLUDED.payload,source=EXCLUDED.source,pdf=EXCLUDED.pdf,page=1,scroll=0,sequence=0,started_at=clock_timestamp()
      RETURNING ${READING_COLUMNS}`,
      [
        found.id,
        presenter,
        JSON.stringify(payload),
        source ? JSON.stringify(source) : null,
        pdf ? Buffer.from(pdf) : null,
        now(),
        found.candidateId,
        found.coachId,
      ],
    );
    const row = rows[0];
    return row ? stateOf(row) : null;
  }
  return {
    canUse: async (actor: ReadingActor, sessionId: string) => Boolean(await session(actor, sessionId)),
    async available(candidateId: string) {
      const { rows } = await database.query<Session>(
        `SELECT ${SESSION_COLUMNS} FROM coaching_session s JOIN human_coach h ON h.id=s.coach_id AND h.retired_at IS NULL
        WHERE s.candidate_id=$1 AND s.withdrawn_at IS NULL AND s.scheduled_at-interval '10 minutes'<=$2 AND s.scheduled_at+(coalesce(s.duration_minutes,60)+30)*interval '1 minute'>=$2 ORDER BY s.scheduled_at`,
        [candidateId, now()],
      );
      return rows.map((row) => ({ id: row.id, coachName: row.coachName }));
    },
    async startCandidate(actor: ReadingActor, sessionId: string, input: unknown) {
      const source = sharedSourceSchema.safeParse(input);
      if (!source.success) return null;
      const found = await session(actor, sessionId);
      if (!found || found.candidateId !== actor.candidateId) return null;
      const document = await deps.document(actor.candidateId, source.data);
      if (!document || document.kind === "pdf") return null;
      return start(found, "candidate", document, source.data, null);
    },
    async presentPdf(actor: ReadingActor, sessionId: string, file: { name: string; bytes: Uint8Array }) {
      const found = await session(actor, sessionId);
      if (!found || found.coachId !== actor.coachId) return null;
      if (
        !file.name.toLowerCase().endsWith(".pdf") ||
        file.bytes.length < 5 ||
        file.bytes.length > SHARED_PDF_MAX_BYTES ||
        Buffer.from(file.bytes.slice(0, 5)).toString() !== "%PDF-"
      )
        return null;
      if (!deps.validatePdf || !(await deps.validatePdf(file.bytes))) return null;
      const title = file.name
        .split(/[\\/]/)
        .at(-1)!
        .replace(/[\r\n]/g, " ")
        .slice(0, 160);
      return start(found, "coach", { kind: "pdf", title }, null, file.bytes);
    },
    async current(actor: ReadingActor, sessionId: string): Promise<SharedReadingState | null> {
      const found = await active(actor, sessionId);
      return found ? stateOf(found.row) : null;
    },
    async document(actor: ReadingActor, sessionId: string, shareId: string): Promise<{ document: SharedDocument; pdf: Buffer | null } | null> {
      if (!UUID.test(shareId)) return null;
      const found = await active(actor, sessionId, shareId, true);
      return found ? { document: found.row.payload, pdf: found.row.pdf } : null;
    },
    async move(actor: ReadingActor, sessionId: string, shareId: string, input: unknown): Promise<boolean> {
      const position = z
        .object({ page: z.number().int().min(1).max(1000), scroll: z.number().min(0).max(1), sequence: z.number().int().min(1).max(2_147_483_647) })
        .safeParse(input);
      if (!position.success || !UUID.test(shareId)) return false;
      const found = await active(actor, sessionId, shareId);
      if (!found) return false;
      if (found.row.presenter === "candidate" ? found.session.candidateId !== actor.candidateId : found.session.coachId !== actor.coachId) return false;
      const result = await database.query("UPDATE shared_reading SET page=$3,scroll=$4,sequence=$5 WHERE session_id=$1 AND id=$2 AND sequence<$5", [
        sessionId,
        shareId,
        position.data.page,
        position.data.scroll,
        position.data.sequence,
      ]);
      return result.rowCount === 1;
    },
    async stop(actor: ReadingActor, sessionId: string): Promise<boolean> {
      if (!UUID.test(sessionId)) return false;
      const result = await database.query(
        `DELETE FROM shared_reading r USING coaching_session s WHERE r.session_id=s.id AND s.id=$1 AND (s.candidate_id=$2 OR (s.coach_id=$3::uuid AND EXISTS (SELECT 1 FROM human_coach h WHERE h.id=s.coach_id AND h.retired_at IS NULL)))`,
        [sessionId, actor.candidateId, actor.coachId ?? null],
      );
      return result.rowCount === 1;
    },
  };
}
function stateOf(row: ReadingRow): SharedReadingState {
  return {
    id: row.id,
    presenter: row.presenter,
    page: row.page,
    scroll: row.scroll,
    sequence: row.sequence,
    document: { kind: row.payload.kind, title: row.payload.title },
  };
}
export async function purgeExpiredSharedReading(database: Queryable, now: Date): Promise<number> {
  const result = await database.query(
    `DELETE FROM shared_reading r USING coaching_session s,human_coach h WHERE r.session_id=s.id AND h.id=s.coach_id AND
    (h.retired_at IS NOT NULL OR s.withdrawn_at IS NOT NULL OR s.scheduled_at IS NULL OR s.scheduled_at-interval '10 minutes'>$1 OR s.scheduled_at+(coalesce(s.duration_minutes,60)+30)*interval '1 minute'<$1)`,
    [now],
  );
  return result.rowCount ?? 0;
}
export async function migrateSharedReading(database: Pool) {
  await database.query(`CREATE TABLE IF NOT EXISTS shared_reading (
    session_id uuid PRIMARY KEY REFERENCES coaching_session(id) ON DELETE CASCADE,id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    presenter text NOT NULL CHECK(presenter IN ('candidate','coach')),payload jsonb NOT NULL,source jsonb,pdf bytea,
    page integer NOT NULL DEFAULT 1,scroll double precision NOT NULL DEFAULT 0,sequence integer NOT NULL DEFAULT 0,started_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );`);
}
