/** Coach Enrolment: email ownership first, an audited human decision second, then a versioned contract gate (#875). */
import { z } from "zod";
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import { PROOF_MAX_BYTES } from "./limits";
export { PROOF_MAX_BYTES } from "./limits";
export const UNCONFIRMED_DAYS = 7;
export const REFUSED_MONTHS = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = z.array(z.string().trim().min(1).max(80)).min(1).max(12);
const applicationSchema = z.object({
  kind: z.enum(["coach", "association"]),
  contactName: z.string().trim().min(2).max(160),
  legalName: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  status: z.string().trim().min(1).max(120),
  siret: z.string().regex(/^\d{14}$/),
  specialties: list,
  languages: list,
  presentation: z.string().trim().min(20).max(4000),
  locale: z.enum(["fr", "en"]).default("fr"),
});
export type EnrolmentInput = z.infer<typeof applicationSchema>;
export interface Enrolment extends EnrolmentInput {
  id: string;
  state: "awaiting_email" | "pending" | "approved" | "refused";
  createdAt: Date;
  confirmedAt: Date | null;
  decidedAt: Date | null;
  reason: string | null;
  humanCoachId: string | null;
  associationId: string | null;
  proofName: string;
}
export interface EnrolmentPerson {
  id: string;
  email: string;
  emailVerified: boolean;
}
export interface EnrolmentDeps {
  validateProof?(bytes: Uint8Array): Promise<boolean>;
  confirmEmail?(email: string, id: string, locale: "fr" | "en"): Promise<void>;
  sendDecision?(record: Enrolment): Promise<void>;
  now?: () => Date;
}
export type DecisionResult = { ok: true; changed: boolean; enrolment: Enrolment } | { ok: false; error: "invalid" | "not_found" | "duplicate" };
const COLUMNS = `id,kind,contact_name AS "contactName",legal_name AS "legalName",email,legal_status AS status,siret,specialties,languages,presentation,locale,state,created_at AS "createdAt",confirmed_at AS "confirmedAt",decided_at AS "decidedAt",reason,human_coach_id AS "humanCoachId",association_id AS "associationId",proof_name AS "proofName"`;
export function coachEnrolments(database: Pool, deps: EnrolmentDeps = {}) {
  const now = deps.now ?? (() => new Date());
  async function owned(person: EnrolmentPerson, id: string) {
    if (!person.emailVerified || !UUID.test(id)) return null;
    return (
      (
        await database.query<Enrolment>(`SELECT ${COLUMNS} FROM coach_enrolment WHERE id=$1 AND (candidate_id=$3 OR (state='awaiting_email' AND email=$2))`, [
          id,
          person.email.trim().toLowerCase(),
          person.id,
        ])
      ).rows[0] ?? null
    );
  }
  async function decideWithin(id: string, decision: unknown, reason: unknown, within: Queryable): Promise<DecisionResult> {
    if (!UUID.test(id) || !(decision === "approve" || decision === "refuse")) return { ok: false, error: "invalid" };
    const refusal = typeof reason === "string" ? reason.trim() : "";
    if (decision === "refuse" && (refusal.length < 3 || refusal.length > 2000)) return { ok: false, error: "invalid" };
    const before = (await within.query<Enrolment>(`SELECT ${COLUMNS} FROM coach_enrolment WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!before || before.state === "awaiting_email") return { ok: false, error: "not_found" };
    if (before.state !== "pending") return { ok: true, changed: false, enrolment: before };
    let humanCoachId: string | null = null,
      associationId: string | null = null;
    if (decision === "approve") {
      if (before.kind === "coach") {
        // A retired coach gets a new identity, never access to the retired identity's private notes or grants.
        humanCoachId =
          (
            await within.query<{ id: string }>(
              `INSERT INTO human_coach(name,email,booking_url,bio,contract_pending,public_ready) VALUES($1,$2,'',$3,true,false) ON CONFLICT(email) WHERE retired_at IS NULL DO NOTHING RETURNING id`,
              [before.contactName, before.email, before.presentation],
            )
          ).rows[0]?.id ?? null;
        if (!humanCoachId) return { ok: false, error: "duplicate" };
      } else {
        const owner = (await within.query<{ candidateId: string | null }>(`SELECT candidate_id AS "candidateId" FROM coach_enrolment WHERE id=$1`, [id]))
          .rows[0]?.candidateId;
        if (!owner) return { ok: false, error: "not_found" };
        associationId =
          (
            await within.query<{ id: string }>(
              `INSERT INTO coach_association(name,legal_status,siret,contract_pending) VALUES($1,$2,$3,true) ON CONFLICT(siret) WHERE retired_at IS NULL DO NOTHING RETURNING id`,
              [before.legalName, before.status, before.siret],
            )
          ).rows[0]?.id ?? null;
        if (!associationId) return { ok: false, error: "duplicate" };
        await within.query("INSERT INTO coach_association_manager(association_id,candidate_id) VALUES($1,$2)", [associationId, owner]);
      }
    }
    const { rows } = await within.query<Enrolment>(
      `UPDATE coach_enrolment SET state=$2,reason=$3,human_coach_id=$4,association_id=$5,decided_at=$6 WHERE id=$1 RETURNING ${COLUMNS}`,
      [id, decision === "approve" ? "approved" : "refused", decision === "refuse" ? refusal : null, humanCoachId, associationId, now()],
    );
    return { ok: true, changed: true, enrolment: rows[0]! };
  }
  return {
    owned,
    async allowSubmission(key: string): Promise<boolean> {
      if (!/^[a-f0-9]{64}$/.test(key)) return false;
      const { rows } = await database.query(
        `INSERT INTO coach_enrolment_rate_limit(key,hour,attempts) VALUES($1,date_trunc('hour',$2::timestamptz),1) ON CONFLICT(key,hour) DO UPDATE SET attempts=coach_enrolment_rate_limit.attempts+1 WHERE coach_enrolment_rate_limit.attempts<5 RETURNING attempts`,
        [key, now()],
      );
      return rows.length === 1;
    },
    async submit(
      input: unknown,
      proof: { name: string; bytes: Uint8Array },
      person?: EnrolmentPerson | null,
    ): Promise<{ ok: true; id: string | null } | { ok: false; error: "invalid" | "unavailable" }> {
      const parsed = applicationSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      if (
        !proof.name.toLowerCase().endsWith(".pdf") ||
        proof.bytes.length < 5 ||
        proof.bytes.length > PROOF_MAX_BYTES ||
        Buffer.from(proof.bytes.subarray(0, 5)).toString() !== "%PDF-" ||
        !deps.validateProof ||
        !(await deps.validateProof(proof.bytes))
      )
        return { ok: false, error: "invalid" };
      const x = parsed.data;
      const verified = person?.emailVerified && person.email.trim().toLowerCase() === x.email;
      const fileName = proof.name
        .split(/[\\/]/)
        .at(-1)!
        .replace(/\p{Cc}/gu, " ")
        .slice(0, 160);
      const { rows } = await database.query<{ id: string }>(
        `INSERT INTO coach_enrolment(kind,contact_name,legal_name,email,legal_status,siret,specialties,languages,presentation,locale,proof_name,proof,candidate_id,state,confirmed_at)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,(SELECT id FROM candidate WHERE email=$4),$13,$14
     WHERE NOT EXISTS(SELECT 1 FROM human_coach WHERE email=$4 AND retired_at IS NULL)
       AND NOT EXISTS(SELECT 1 FROM coach_association a JOIN coach_association_manager m ON m.association_id=a.id JOIN candidate c ON c.id=m.candidate_id WHERE c.email=$4 AND a.retired_at IS NULL)
     ON CONFLICT(email) WHERE state IN ('awaiting_email','pending') DO NOTHING RETURNING id`,
        [
          x.kind,
          x.contactName,
          x.legalName,
          x.email,
          x.status,
          x.siret,
          x.specialties,
          x.languages,
          x.presentation,
          x.locale,
          fileName,
          Buffer.from(proof.bytes),
          verified ? "pending" : "awaiting_email",
          verified ? now() : null,
        ],
      );
      const id = rows[0]?.id ?? null;
      if (!id) return { ok: true, id: null };
      if (verified) return { ok: true, id };
      try {
        if (!deps.confirmEmail) throw new Error("Email confirmation unavailable");
        await deps.confirmEmail(x.email, id, x.locale);
      } catch {
        await database.query("DELETE FROM coach_enrolment WHERE id=$1 AND state='awaiting_email'", [id]);
        return { ok: false, error: "unavailable" };
      }
      return { ok: true, id };
    },
    async confirm(person: EnrolmentPerson, id: string): Promise<Enrolment | null> {
      if (!person.emailVerified || !UUID.test(id)) return null;
      await database.query("UPDATE coach_enrolment SET state='pending',candidate_id=$2,confirmed_at=$3 WHERE id=$1 AND email=$4 AND state='awaiting_email'", [
        id,
        person.id,
        now(),
        person.email.trim().toLowerCase(),
      ]);
      const record = await owned(person, id);
      return record?.state === "awaiting_email" ? null : record;
    },
    async withdraw(person: EnrolmentPerson, id: string): Promise<boolean> {
      if (!person.emailVerified || !UUID.test(id)) return false;
      return (
        (
          await database.query(
            "DELETE FROM coach_enrolment WHERE id=$1 AND (candidate_id=$3 OR (state='awaiting_email' AND email=$2)) AND state IN ('awaiting_email','pending')",
            [id, person.email.trim().toLowerCase(), person.id],
          )
        ).rowCount === 1
      );
    },
    async own(person: EnrolmentPerson): Promise<Enrolment[]> {
      if (!person.emailVerified) return [];
      return (
        await database.query<Enrolment>(
          `SELECT ${COLUMNS} FROM coach_enrolment WHERE candidate_id=$1 OR (state='awaiting_email' AND email=$2) ORDER BY created_at DESC`,
          [person.id, person.email.trim().toLowerCase()],
        )
      ).rows;
    },
    async approvedActive(person: EnrolmentPerson): Promise<Enrolment[]> {
      if (!person.emailVerified) return [];
      return (
        await database.query<Enrolment>(
          `SELECT ${COLUMNS} FROM coach_enrolment e WHERE e.candidate_id=$1 AND e.state='approved' AND (EXISTS(SELECT 1 FROM human_coach h WHERE h.id=e.human_coach_id AND h.retired_at IS NULL) OR EXISTS(SELECT 1 FROM coach_association a WHERE a.id=e.association_id AND a.retired_at IS NULL)) ORDER BY e.decided_at DESC`,
          [person.id],
        )
      ).rows;
    },
    async queue(): Promise<Enrolment[]> {
      return (
        await database.query<Enrolment>(
          `SELECT ${COLUMNS} FROM coach_enrolment WHERE state!='awaiting_email' ORDER BY CASE WHEN state='pending' THEN 0 ELSE 1 END,created_at DESC LIMIT 100`,
        )
      ).rows;
    },
    async proofInfo(id: string): Promise<{ name: string; size: number } | null> {
      if (!UUID.test(id)) return null;
      return (
        (
          await database.query<{ name: string; size: number }>(
            "SELECT proof_name AS name,octet_length(proof) AS size FROM coach_enrolment WHERE id=$1 AND state!='awaiting_email'",
            [id],
          )
        ).rows[0] ?? null
      );
    },
    async proof(id: string): Promise<{ name: string; bytes: Buffer } | null> {
      if (!UUID.test(id)) return null;
      return (
        (
          await database.query<{ name: string; bytes: Buffer }>(
            "SELECT proof_name AS name,proof AS bytes FROM coach_enrolment WHERE id=$1 AND state!='awaiting_email'",
            [id],
          )
        ).rows[0] ?? null
      );
    },
    decide(id: string, decision: unknown, reason: unknown, within?: Queryable): Promise<DecisionResult> {
      return within ? decideWithin(id, decision, reason, within) : inTransaction(database, (client) => decideWithin(id, decision, reason, client));
    },
    async deliverNotices(limit = 20): Promise<number> {
      if (!deps.sendDecision) return 0;
      let sent = 0;
      for (let i = 0; i < limit; i++) {
        const { rows } = await database.query<Enrolment & { claim: string }>(
          `UPDATE coach_enrolment SET notice_claim=gen_random_uuid(),notice_claimed_at=$1 WHERE id=(SELECT id FROM coach_enrolment WHERE state IN ('approved','refused') AND notice_sent_at IS NULL AND (notice_claimed_at IS NULL OR notice_claimed_at<$1::timestamptz-interval '5 minutes') ORDER BY decided_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING ${COLUMNS},notice_claim AS claim`,
          [now()],
        );
        const row = rows[0];
        if (!row) break;
        try {
          await deps.sendDecision(row);
          await database.query("UPDATE coach_enrolment SET notice_sent_at=$3,notice_claim=NULL,notice_claimed_at=NULL WHERE id=$1 AND notice_claim=$2", [
            row.id,
            row.claim,
            now(),
          ]);
          sent++;
        } catch {
          await database.query("UPDATE coach_enrolment SET notice_claim=NULL,notice_claimed_at=NULL WHERE id=$1 AND notice_claim=$2", [row.id, row.claim]);
          break;
        }
      }
      return sent;
    },
    async purge(): Promise<number> {
      const removed = await database.query(
        `DELETE FROM coach_enrolment WHERE (state='awaiting_email' AND created_at<$1::timestamptz-make_interval(days=>$2)) OR (state='refused' AND decided_at<$1::timestamptz-make_interval(months=>$3))`,
        [now(), UNCONFIRMED_DAYS, REFUSED_MONTHS],
      );
      await database.query("DELETE FROM coach_enrolment_rate_limit WHERE hour<$1::timestamptz-interval '2 days'", [now()]);
      return removed.rowCount ?? 0;
    },
  };
}
export async function migrateCoachEnrolments(database: Pool) {
  await database.query(`CREATE TABLE IF NOT EXISTS coach_association(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,legal_status text NOT NULL,siret text NOT NULL,contract_pending boolean NOT NULL DEFAULT true,retired_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
 CREATE UNIQUE INDEX IF NOT EXISTS coach_association_siret ON coach_association(siret) WHERE retired_at IS NULL;
 CREATE TABLE IF NOT EXISTS coach_association_manager(association_id uuid NOT NULL REFERENCES coach_association(id) ON DELETE CASCADE,candidate_id text NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,PRIMARY KEY(association_id,candidate_id));
 CREATE TABLE IF NOT EXISTS coach_enrolment(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('coach','association')),contact_name text NOT NULL,legal_name text NOT NULL,email text NOT NULL,legal_status text NOT NULL,siret text NOT NULL,specialties text[] NOT NULL,languages text[] NOT NULL,presentation text NOT NULL,locale text NOT NULL,state text NOT NULL DEFAULT 'awaiting_email' CHECK(state IN ('awaiting_email','pending','approved','refused')),candidate_id text REFERENCES candidate(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),confirmed_at timestamptz,decided_at timestamptz,reason text,human_coach_id uuid REFERENCES human_coach(id),association_id uuid REFERENCES coach_association(id),proof_name text NOT NULL,proof bytea NOT NULL,notice_claim uuid,notice_claimed_at timestamptz,notice_sent_at timestamptz);
 CREATE UNIQUE INDEX IF NOT EXISTS coach_enrolment_pending_email ON coach_enrolment(email) WHERE state IN ('awaiting_email','pending');
 CREATE INDEX IF NOT EXISTS coach_enrolment_candidate ON coach_enrolment(candidate_id);
 CREATE TABLE IF NOT EXISTS coach_enrolment_rate_limit(key text NOT NULL,hour timestamptz NOT NULL,attempts integer NOT NULL,PRIMARY KEY(key,hour));`);
}

/** Partner applications are personal data too; include the original professional PDF, never a notice claim or IP hash. */
export async function coachEnrolmentsOf(database: Queryable, candidateId: string) {
  const { rows } = await database.query<Enrolment & { proof: Buffer }>(
    `SELECT ${COLUMNS},proof FROM coach_enrolment WHERE candidate_id=$1 OR (state='awaiting_email' AND email=(SELECT email FROM candidate WHERE id=$1)) ORDER BY created_at,id`,
    [candidateId],
  );
  return rows.map(({ proof, ...record }) => ({
    ...record,
    proof: { name: record.proofName, contentType: "application/pdf", base64: proof.toString("base64") },
  }));
}
export async function associationsManagedBy(database: Queryable, candidateId: string) {
  return (
    await database.query<{ id: string; name: string; status: string; siret: string }>(
      `SELECT a.id,a.name,a.legal_status AS status,a.siret FROM coach_association_manager m JOIN coach_association a ON a.id=m.association_id WHERE m.candidate_id=$1 ORDER BY a.created_at,a.id`,
      [candidateId],
    )
  ).rows;
}
export { coachEnrolmentDecisionEmail } from "./email";
