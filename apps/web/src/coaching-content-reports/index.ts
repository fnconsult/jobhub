/** Anonymous notice-and-action requests share the Signalements Back Office, without requiring a Candidate account. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import { REPORT_REASONS, REPORT_OUTCOMES, type ReportReason, type ReportOutcome } from "./values";
export type { ReportReason, ReportOutcome } from "./values";
export interface ContentReportRow {
  id: string;
  coachId: string;
  coachName: string;
  target: "page" | "offer";
  outcome: ReportOutcome | null;
  revision: number;
  decidedAt: Date | null;
  reason: ReportReason | null;
  explanation: string | null;
  reporterName: string | null;
  reporterEmail: string | null;
  createdAt: Date | null;
  decisionReason: string | null;
}
export interface ReportNotice {
  id: string;
  to: string;
  locale: "fr" | "en";
  kind: "receipt" | "decision";
  reportId: string;
  target: "page" | "offer";
  coachName: string;
  outcome?: ReportOutcome;
  reason?: string;
  recipient?: string;
  sellerId?: string | null;
}
export interface ReportDeps {
  send(notice: ReportNotice): Promise<void>;
  now?: () => Date;
  platformEmail?: () => string | undefined;
}
const inputSchema = z
  .object({
    requestId: z.uuid(),
    target: z.enum(["page", "offer"]),
    coachId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
    explanation: z.string().trim().min(10).max(4000),
    name: z.string().trim().max(160).default(""),
    email: z.union([z.email(), z.literal("")]).default(""),
    goodFaith: z.literal(true),
    locale: z.enum(["fr", "en"]),
  })
  .strict()
  .refine((x) => x.reason === "child_abuse" || Boolean(x.name && x.email));
export function coachingContentReports(database: Pool, deps: ReportDeps) {
  const now = deps.now ?? (() => new Date());
  return {
    async submit(input: unknown, person: { id: string; email: string; emailVerified: boolean } | null) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" } as const;
      const x = parsed.data,
        fingerprint = createHash("sha256").update(JSON.stringify(x)).digest("hex");
      return inTransaction(database, async (within) => {
        const target = (
          await within.query<{ name: string; email: string }>(
            `SELECT h.name,h.email FROM human_coach h WHERE h.id=$1 AND h.retired_at IS NULL AND h.public_ready AND NOT h.contract_pending AND ($2='page' OR EXISTS(SELECT 1 FROM coaching_offer o WHERE o.coach_id=h.id))`,
            [x.coachId, x.target],
          )
        ).rows[0];
        if (!target) return { ok: false, error: "not_found" } as const;
        const owner = person?.emailVerified && person.email.toLowerCase() === x.email.toLowerCase() ? person.id : null;
        await within.query("INSERT INTO coaching_content_case(id,coach_id,target) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [x.requestId, x.coachId, x.target]);
        const row = (
          await within.query<{ id: string }>(
            `INSERT INTO coaching_content_report(id,coach_id,target,reason,explanation,reporter_name,reporter_email,locale,candidate_id,fingerprint,created_at,coach_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET fingerprint=coaching_content_report.fingerprint WHERE coaching_content_report.fingerprint=excluded.fingerprint RETURNING id`,
            [x.requestId, x.coachId, x.target, x.reason, x.explanation, x.name, x.email.toLowerCase(), x.locale, owner, fingerprint, now(), target.name],
          )
        ).rows[0];
        if (!row) return { ok: false, error: "invalid" } as const;
        if (x.email)
          await within.query(
            `INSERT INTO coaching_content_report_notice(case_id,recipient,email,locale,kind,revision) VALUES($1,'reporter',$2,$3,'receipt',0) ON CONFLICT DO NOTHING`,
            [row.id, x.email.toLowerCase(), x.locale],
          );
        return { ok: true, id: row.id } as const;
      });
    },
    async blocked(coachId: string, target: "page" | "offer") {
      return Boolean(
        (
          await database.query("SELECT 1 FROM coaching_content_case WHERE coach_id=$1 AND target=$2 AND outcome IN ('remove','suspend') LIMIT 1", [
            coachId,
            target,
          ])
        ).rowCount,
      );
    },
    async list() {
      return (
        await database.query<ContentReportRow>(
          `SELECT c.id,c.coach_id AS "coachId",h.name AS "coachName",c.target,c.outcome,c.revision,c.decided_at AS "decidedAt",r.reason,r.explanation,r.reporter_name AS "reporterName",r.reporter_email AS "reporterEmail",r.created_at AS "createdAt",r.decision_reason AS "decisionReason" FROM coaching_content_case c JOIN human_coach h ON h.id=c.coach_id LEFT JOIN coaching_content_report r ON r.id=c.id ORDER BY c.decided_at NULLS FIRST,r.created_at,c.id`,
        )
      ).rows;
    },
    async decide(id: string, input: unknown, within: Queryable) {
      const parsed = z
        .object({
          outcome: z.enum(REPORT_OUTCOMES),
          reason: z.string().trim().min(3).max(2000),
          expectedRevision: z.number().int().nonnegative(),
        })
        .strict()
        .safeParse(input);
      if (!z.uuid().safeParse(id).success || !parsed.success) return null;
      const x = parsed.data;
      const current = (
        await within.query(
          `SELECT c.*,h.name AS coach_name,h.email AS coach_email,r.reporter_email,r.locale FROM coaching_content_case c JOIN human_coach h ON h.id=c.coach_id LEFT JOIN coaching_content_report r ON r.id=c.id WHERE c.id=$1 FOR UPDATE OF c`,
          [id],
        )
      ).rows[0];
      if (!current || current.revision !== x.expectedRevision) return null;
      const revision = current.revision + 1;
      await within.query("UPDATE coaching_content_case SET outcome=$2,revision=$3,decided_at=$4 WHERE id=$1", [id, x.outcome, revision, now()]);
      await within.query("UPDATE coaching_content_report SET decision_reason=$2 WHERE id=$1", [id, x.reason]);
      const seller =
        current.target === "page"
          ? { kind: "human_coach", email: current.coach_email }
          : (
              await within.query(
                `SELECT s.id AS seller_id,s.kind,CASE WHEN s.kind='jobbbox' THEN NULL WHEN s.kind='human_coach' THEN h.email ELSE (SELECT c.email FROM coach_association_manager m JOIN candidate c ON c.id=m.candidate_id AND c."emailVerified" WHERE m.association_id=s.association_id ORDER BY c.id LIMIT 1) END AS email FROM coaching_offer o JOIN coaching_seller s ON s.id=o.seller_id LEFT JOIN human_coach h ON h.id=s.coach_id WHERE o.coach_id=$1`,
                [current.coach_id],
              )
            ).rows[0];
      for (const recipient of [
        { kind: "reporter", email: current.reporter_email, locale: current.locale ?? "fr" },
        { kind: seller?.kind === "jobbbox" ? "platform" : "seller", email: seller?.email ?? null, locale: "fr" },
      ]) {
        if (recipient.kind === "reporter" && !recipient.email) continue;
        await within.query(
          `INSERT INTO coaching_content_report_notice(case_id,recipient,email,locale,kind,revision,outcome,reason,seller_id) VALUES($1,$2,$3,$4,'decision',$5,$6,$7,$8)`,
          [
            id,
            recipient.kind,
            recipient.email,
            recipient.locale,
            revision,
            x.outcome,
            x.reason,
            recipient.kind === "reporter" ? null : (seller?.seller_id ?? null),
          ],
        );
      }
      return { before: { outcome: current.outcome, revision: current.revision }, after: { outcome: x.outcome, revision, reason: x.reason } };
    },
    async allowSubmission(key: string) {
      if (!/^[a-f0-9]{64}$/.test(key)) return false;
      return Boolean(
        (
          await database.query(
            `INSERT INTO coaching_content_report_rate(key,hour,attempts) VALUES($1,date_trunc('hour',$2::timestamptz),1) ON CONFLICT(key,hour) DO UPDATE SET attempts=coaching_content_report_rate.attempts+1 WHERE coaching_content_report_rate.attempts<10 RETURNING attempts`,
            [key, now()],
          )
        ).rowCount,
      );
    },
    async purge() {
      await database.query("DELETE FROM coaching_content_report_notice WHERE sent_at<$1", [new Date(+now() - 3 * 365 * 86400000)]);
      await database.query("DELETE FROM coaching_content_report WHERE id IN (SELECT id FROM coaching_content_case WHERE decided_at<$1)", [
        new Date(+now() - 3 * 365 * 86400000),
      ]);
      await database.query(
        "DELETE FROM coaching_content_case WHERE NOT EXISTS(SELECT 1 FROM coaching_content_report r WHERE r.id=coaching_content_case.id) AND (outcome IS NULL OR outcome='keep') AND NOT EXISTS(SELECT 1 FROM coaching_content_report_notice n WHERE n.case_id=coaching_content_case.id AND n.sent_at IS NULL)",
      );
      await database.query("DELETE FROM coaching_content_report_rate WHERE hour<$1", [new Date(+now() - 86400000)]);
    },
    async deliverNotices(caseId?: string) {
      const due = (
        await database.query<{ id: string }>(
          `SELECT id FROM coaching_content_report_notice WHERE sent_at IS NULL AND (retry_at IS NULL OR retry_at<=$1) AND ($2::uuid IS NULL OR case_id=$2) ORDER BY created_at,id LIMIT 100`,
          [now(), caseId ?? null],
        )
      ).rows;
      for (const item of due) {
        const within = await database.connect();
        try {
          const locked = (await within.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,886)) AS locked", [item.id])).rows[0]
            ?.locked;
          if (!locked) continue;
          const row = (
            await within.query<ReportNotice>(
              `SELECT n.id,n.email AS "to",n.locale,n.kind,n.recipient,n.seller_id AS "sellerId",n.case_id AS "reportId",c.target,h.name AS "coachName",n.outcome,n.reason FROM coaching_content_report_notice n JOIN coaching_content_case c ON c.id=n.case_id JOIN human_coach h ON h.id=c.coach_id WHERE n.id=$1 AND n.sent_at IS NULL AND (n.retry_at IS NULL OR n.retry_at<=$2)`,
              [item.id, now()],
            )
          ).rows[0];
          if (!row) continue;
          try {
            row.to = row.to || (row.recipient === "platform" ? deps.platformEmail?.() : undefined) || "";
            if (!row.to && row.sellerId)
              row.to =
                (
                  await within.query(
                    `SELECT coalesce(h.email,(SELECT c.email FROM coach_association_manager m JOIN candidate c ON c.id=m.candidate_id AND c."emailVerified" WHERE m.association_id=s.association_id ORDER BY c.id LIMIT 1)) AS email FROM coaching_seller s LEFT JOIN human_coach h ON h.id=s.coach_id WHERE s.id=$1`,
                    [row.sellerId],
                  )
                ).rows[0]?.email ?? "";
            if (!row.to) throw Error("Seller contact unavailable");
            await deps.send(row);
            await within.query("UPDATE coaching_content_report_notice SET sent_at=$2,retry_at=NULL WHERE id=$1", [item.id, now()]);
          } catch {
            await within.query("UPDATE coaching_content_report_notice SET retry_at=$2 WHERE id=$1", [item.id, new Date(+now() + 300000)]);
          }
        } finally {
          try {
            await within.query("SELECT pg_advisory_unlock(hashtextextended($1,886))", [item.id]);
          } finally {
            within.release();
          }
        }
      }
    },
  };
}
export async function migrateCoachingContentReports(database: Queryable) {
  await database.query(`
 CREATE TABLE IF NOT EXISTS coaching_content_case(id uuid PRIMARY KEY,coach_id uuid NOT NULL REFERENCES human_coach(id),target text NOT NULL CHECK(target IN ('page','offer')),outcome text CHECK(outcome IN ('remove','suspend','keep')),revision integer NOT NULL DEFAULT 0,decided_at timestamptz);
 CREATE TABLE IF NOT EXISTS coaching_content_report(id uuid PRIMARY KEY REFERENCES coaching_content_case(id) ON DELETE CASCADE,coach_id uuid NOT NULL REFERENCES human_coach(id),target text NOT NULL CHECK(target IN ('page','offer')),reason text NOT NULL,explanation text NOT NULL,reporter_name text NOT NULL,reporter_email text NOT NULL,locale text NOT NULL,candidate_id text REFERENCES candidate(id) ON DELETE CASCADE,fingerprint text NOT NULL,created_at timestamptz NOT NULL,coach_name text NOT NULL,decision_reason text);
 CREATE TABLE IF NOT EXISTS coaching_content_report_notice(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES coaching_content_case(id) ON DELETE CASCADE,recipient text NOT NULL,email text,seller_id uuid,locale text NOT NULL,kind text NOT NULL,revision integer NOT NULL,outcome text,reason text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),retry_at timestamptz,sent_at timestamptz,UNIQUE(case_id,recipient,kind,revision));
 CREATE TABLE IF NOT EXISTS coaching_content_report_rate(key text NOT NULL,hour timestamptz NOT NULL,attempts integer NOT NULL,PRIMARY KEY(key,hour));
 CREATE OR REPLACE FUNCTION coaching_content_report_erased() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM coaching_content_report_notice WHERE case_id=OLD.id AND recipient='reporter'; RETURN OLD;END $$;
 DROP TRIGGER IF EXISTS coaching_content_report_erased ON coaching_content_report;
 CREATE TRIGGER coaching_content_report_erased BEFORE DELETE ON coaching_content_report FOR EACH ROW EXECUTE FUNCTION coaching_content_report_erased();
`);
}
export async function contentReportsOf(database: Queryable, candidateId: string) {
  const reports = (
    await database.query(
      `SELECT r.id,r.coach_id AS "coachId",r.target,r.reason,r.explanation,true AS "goodFaith",r.reporter_name AS "name",r.reporter_email AS email,r.locale,r.created_at AS "createdAt",c.outcome,c.revision,c.decided_at AS "decidedAt",r.decision_reason AS "decisionReason" FROM coaching_content_report r JOIN coaching_content_case c ON c.id=r.id WHERE r.candidate_id=$1 ORDER BY r.created_at,r.id`,
      [candidateId],
    )
  ).rows;
  const notices = (
    await database.query(
      `SELECT n.case_id AS "reportId",n.kind,n.revision,n.email AS "recipientEmail",n.outcome,n.reason,n.created_at AS "createdAt",n.sent_at AS "sentAt" FROM coaching_content_report_notice n JOIN coaching_content_report r ON r.id=n.case_id WHERE r.candidate_id=$1 AND n.recipient='reporter' ORDER BY n.created_at,n.id`,
      [candidateId],
    )
  ).rows;
  return { reports, notices };
}
