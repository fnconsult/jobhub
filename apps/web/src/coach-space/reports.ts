/** Human-written Session Reports, immutable once published; corrections are new reports/messages. */
import { z } from "zod";
import type { Pool } from "pg";
import { createI18n, isSupportedLocale } from "@jobhub/shared/i18n";
import { nameForCoach } from "../candidate-identity/names";
import type { CoachConversations } from "../coach-conversations";
import { inTransaction } from "../database/pool";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = z.object({ covered: z.string().max(10_000), nextSteps: z.string().max(10_000), resources: z.string().max(5_000) });
export type ReportFields = z.infer<typeof fields>;
export interface SessionReport extends ReportFields {
  id: string;
  sessionId: string;
  revision: number;
  publishedAt: Date | null;
  conversationId: string | null;
}
const COLUMNS =
  'r.id,r.session_id AS "sessionId",r.covered,r.next_steps AS "nextSteps",r.resources,r.revision,r.published_at AS "publishedAt",r.conversation_id AS "conversationId"';
const ACTIVE = "EXISTS (SELECT 1 FROM human_coach h WHERE h.id=$1 AND h.retired_at IS NULL)";
const OWNER = `EXISTS (SELECT 1 FROM coaching_session s WHERE s.id=$2 AND s.coach_id=$1 AND s.withdrawn_at IS NULL) AND ${ACTIVE}`;
export function sessionReports(database: Pool, conversations: Pick<CoachConversations, "publishHumanReport">, clock: () => Date = () => new Date()) {
  return {
    async forCoach(coachId: string, sessionId: string): Promise<SessionReport[] | null> {
      if (!UUID.test(coachId) || !UUID.test(sessionId)) return null;
      const permitted = await database.query(`SELECT 1 WHERE ${OWNER}`, [coachId, sessionId]);
      if (!permitted.rowCount) return null;
      const { rows } = await database.query<SessionReport>(
        `SELECT ${COLUMNS} FROM session_report r WHERE r.coach_id=$1 AND r.session_id=$2 AND ${ACTIVE} ORDER BY r.created_at,r.id`,
        [coachId, sessionId],
      );
      return rows;
    },
    async due(coachId: string): Promise<string[]> {
      if (!UUID.test(coachId)) return [];
      const { rows } = await database.query<{ id: string }>(
        `SELECT s.id FROM coaching_session s WHERE s.coach_id=$1 AND s.withdrawn_at IS NULL AND ${ACTIVE}
        AND s.scheduled_at + coalesce(s.duration_minutes,60)*interval '1 minute' < $2
        AND NOT EXISTS (SELECT 1 FROM session_report r WHERE r.session_id=s.id AND r.published_at IS NOT NULL) ORDER BY s.scheduled_at`,
        [coachId, clock()],
      );
      return rows.map((row) => row.id);
    },
    async save(coachId: string, sessionId: string, input: unknown): Promise<SessionReport | null> {
      const parsed = fields.safeParse(input);
      if (!parsed.success || !UUID.test(coachId) || !UUID.test(sessionId)) return null;
      const value = parsed.data;
      const { rows } = await database.query<SessionReport>(
        `INSERT INTO session_report AS r (coach_id,session_id,candidate_id,covered,next_steps,resources)
        SELECT $1,s.id,s.candidate_id,$3,$4,$5 FROM coaching_session s WHERE s.id=$2 AND s.coach_id=$1 AND s.withdrawn_at IS NULL AND ${ACTIVE}
        ON CONFLICT (session_id) WHERE published_at IS NULL DO UPDATE SET covered=EXCLUDED.covered,next_steps=EXCLUDED.next_steps,resources=EXCLUDED.resources,revision=r.revision+1
        WHERE r.coach_id=$1 AND ${ACTIVE} RETURNING ${COLUMNS}`,
        [coachId, sessionId, value.covered, value.nextSteps, value.resources],
      );
      return rows[0] ?? null;
    },
    async publish(
      coachId: string,
      reportId: string,
      revision: unknown,
    ): Promise<{ ok: true; report: SessionReport } | { ok: false; error: "not_found" | "conflict" | "invalid" | "too_early" }> {
      if (!UUID.test(coachId) || !UUID.test(reportId) || !Number.isSafeInteger(revision)) return { ok: false, error: "invalid" };
      return inTransaction(database, async (db) => {
        const { rows } = await db.query<
          SessionReport & {
            candidateId: string;
            scheduledAt: Date | null;
            durationMinutes: number | null;
            interfaceLanguage: string;
            givenName: string | null;
            familyName: string | null;
            preferredName: string | null;
            name: string | null;
          }
        >(
          `
          SELECT ${COLUMNS},s.candidate_id AS "candidateId",s.scheduled_at AS "scheduledAt",s.duration_minutes AS "durationMinutes",c."interfaceLanguage",c.name,c.given_name AS "givenName",c.family_name AS "familyName",c.preferred_name AS "preferredName"
          FROM session_report r JOIN coaching_session s ON s.id=r.session_id JOIN candidate c ON c.id=s.candidate_id
          WHERE r.id=$2 AND r.coach_id=$1 AND s.coach_id=$1 AND s.withdrawn_at IS NULL AND ${ACTIVE} FOR UPDATE OF r`,
          [coachId, reportId],
        );
        const report = rows[0];
        if (!report) return { ok: false, error: "not_found" };
        if (report.publishedAt)
          return {
            ok: true,
            report: {
              id: report.id,
              sessionId: report.sessionId,
              covered: report.covered,
              nextSteps: report.nextSteps,
              resources: report.resources,
              revision: report.revision,
              publishedAt: report.publishedAt,
              conversationId: report.conversationId,
            },
          };
        if (report.revision !== revision) return { ok: false, error: "conflict" };
        if (!report.scheduledAt || +clock() < +report.scheduledAt + (report.durationMinutes ?? 60) * 60_000) return { ok: false, error: "too_early" };
        if (!report.covered.trim()) return { ok: false, error: "invalid" };
        const urls = report.resources
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean);
        if (
          urls.some((value) => {
            try {
              return new URL(value).protocol !== "https:";
            } catch {
              return true;
            }
          })
        )
          return { ok: false, error: "invalid" };
        const t = createI18n(isSupportedLocale(report.interfaceLanguage) ? report.interfaceLanguage : "fr").t;
        const candidateName = nameForCoach(report, "short");
        const candidateLabel = candidateName.name + (candidateName.calledBy ? ` · ${t("coachSpace.calledBy", { name: candidateName.calledBy })}` : "");
        const text = [
          t("coachReports.forCandidate", { name: candidateLabel }),
          `## ${t("coachReports.covered")}\n${report.covered}`,
          `## ${t("coachReports.nextSteps")}\n${report.nextSteps}`,
          `## ${t("coachReports.resources")}\n${urls.join("\n")}`,
        ].join("\n\n");
        const published = await conversations.publishHumanReport(report.candidateId, { id: report.id, sessionId: report.sessionId, coachId, text }, db);
        if (!published) return { ok: false, error: "not_found" };
        const updated = await db.query<SessionReport>(`UPDATE session_report r SET published_at=$2,conversation_id=$3 WHERE id=$1 RETURNING ${COLUMNS}`, [
          report.id,
          clock(),
          published.conversationId,
        ]);
        return { ok: true, report: updated.rows[0]! };
      });
    },
  };
}
export async function migrateSessionReports(database: Pool) {
  await database.query(`CREATE TABLE IF NOT EXISTS session_report (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid NOT NULL REFERENCES coaching_session(id) ON DELETE CASCADE,
    coach_id uuid NOT NULL REFERENCES human_coach(id),candidate_id text NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
    covered text NOT NULL,next_steps text NOT NULL,resources text NOT NULL,revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),published_at timestamptz,conversation_id uuid
  );CREATE UNIQUE INDEX IF NOT EXISTS session_report_draft_idx ON session_report(session_id) WHERE published_at IS NULL;`);
}
