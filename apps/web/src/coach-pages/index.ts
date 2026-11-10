/** Coach-authored snapshots become public only in an audited administrator decision; the last approved one remains served. */
import { z } from "zod";
import type { Pool } from "pg";
import { coachPhotoUrl, type PublicCoachPage } from "@jobhub/shared/coaching-profiles";
import { inTransaction, type Queryable } from "../database/pool";
import { COACH_PHOTO_MAX_BYTES } from "./limits";
export interface CoachPageContent {
  presentation: string;
  specialties: string[];
  languages: string[];
}
export interface CoachPageVersion {
  id: string;
  coachId: string;
  coachName: string;
  email: string;
  revision: number;
  content: CoachPageContent;
  photo: Buffer | null;
  state: "pending" | "approved" | "refused" | "superseded";
  reason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  locale: "fr" | "en";
}
export interface CoachPageDeps {
  normalizePhoto?: (bytes: Uint8Array) => Promise<Buffer | null>;
  sendDecision?: (version: CoachPageVersion) => Promise<void>;
  now?: () => Date;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textList = z.array(z.string().trim().min(1).max(80)).max(12);
const contentSchema = z.object({ presentation: z.string().trim().min(20).max(4000), specialties: textList, languages: textList });
const submissionSchema = z.object({
  basedOn: z.number().int().nonnegative(),
  content: contentSchema,
  photoAction: z.enum(["keep", "replace", "remove"]),
  locale: z.enum(["fr", "en"]),
});
const COLUMNS = `p.id,p.coach_id AS "coachId",h.name AS "coachName",h.email,p.revision,p.content,p.photo,p.state,p.reason,p.created_at AS "createdAt",p.decided_at AS "decidedAt",p.locale`;
/** Legacy biography was already entered by an Administrator. Copy it once, never a coach's pending edit. */
async function copyLegacy(database: Queryable, coachIds: string[] | null = null) {
  await database.query(
    `INSERT INTO coach_page_version(owner_id,coach_id,revision,content,state,created_at,decided_at,source,locale)
 SELECT (SELECT c.id FROM candidate c WHERE lower(c.email)=h.email AND c."emailVerified"),h.id,1,jsonb_build_object('presentation',h.bio,'specialties','[]'::jsonb,'languages','[]'::jsonb),'approved',h.created_at,h.created_at,'legacy_bio','fr'
 FROM human_coach h WHERE h.retired_at IS NULL AND h.public_profile_revision=0 AND h.public_ready AND NOT h.contract_pending AND ($1::uuid[] IS NULL OR h.id=ANY($1)) AND NOT EXISTS(SELECT 1 FROM coach_page_version p WHERE p.coach_id=h.id) ON CONFLICT(coach_id,revision) DO NOTHING`,
    [coachIds],
  );
  await database.query(
    `UPDATE human_coach h SET public_profile_revision=(SELECT max(revision) FROM coach_page_version p WHERE p.coach_id=h.id) WHERE ($1::uuid[] IS NULL OR h.id=ANY($1)) AND h.public_profile_revision<coalesce((SELECT max(revision) FROM coach_page_version p WHERE p.coach_id=h.id),0)`,
    [coachIds],
  );
}
export function coachPages(database: Pool, deps: CoachPageDeps = {}) {
  const now = deps.now ?? (() => new Date());
  async function editor(coachId: string) {
    if (!UUID.test(coachId)) return null;
    return inTransaction(database, async (within) => {
      const coach = (
        await within.query<{ id: string; name: string; bio: string }>("SELECT id,name,bio FROM human_coach WHERE id=$1 AND retired_at IS NULL FOR UPDATE", [
          coachId,
        ])
      ).rows[0];
      if (!coach) return null;
      await copyLegacy(within, [coachId]);
      const rows = (
        await within.query<CoachPageVersion>(
          `SELECT ${COLUMNS} FROM coach_page_version p JOIN human_coach h ON h.id=p.coach_id WHERE p.coach_id=$1 ORDER BY p.revision DESC`,
          [coachId],
        )
      ).rows;
      const head = (await within.query<{ revision: number }>("SELECT public_profile_revision AS revision FROM human_coach WHERE id=$1", [coachId])).rows[0]!
        .revision;
      return { coach, head, latest: rows[0] ?? null, approved: rows.find((p) => p.state === "approved") ?? null };
    });
  }

  return {
    editor,
    async approved(coachIds: string[]): Promise<{ coachId: string; page: PublicCoachPage }[]> {
      const ids = coachIds.filter((x) => UUID.test(x));
      if (!ids.length) return [];
      const rows = (
        await database.query<{ coachId: string; id: string; content: CoachPageContent; hasPhoto: boolean }>(
          `SELECT DISTINCT ON(p.coach_id) p.coach_id AS "coachId",p.id,p.content,(p.photo IS NOT NULL) AS "hasPhoto" FROM coach_page_version p JOIN human_coach h ON h.id=p.coach_id AND h.retired_at IS NULL AND h.public_ready AND NOT h.contract_pending WHERE p.coach_id=ANY($1::uuid[]) AND p.state='approved' ORDER BY p.coach_id,p.revision DESC`,
          [ids],
        )
      ).rows;
      return rows.map((r) => ({ coachId: r.coachId, page: { versionId: r.id, ...r.content, photoUrl: r.hasPhoto ? coachPhotoUrl(r.coachId, r.id) : null } }));
    },
    async photo(coachId: string, versionId: string): Promise<Buffer | null> {
      if (!UUID.test(coachId) || !UUID.test(versionId)) return null;
      return (
        (
          await database.query<{ photo: Buffer | null }>(
            `SELECT p.photo FROM coach_page_version p JOIN human_coach h ON h.id=p.coach_id AND h.retired_at IS NULL AND h.public_ready AND NOT h.contract_pending WHERE p.coach_id=$1 AND p.id=$2 AND p.state='approved' AND p.revision=(SELECT max(q.revision) FROM coach_page_version q WHERE q.coach_id=p.coach_id AND q.state='approved')`,
            [coachId, versionId],
          )
        ).rows[0]?.photo ?? null
      );
    },
    async submit(coachId: string, input: unknown, photo?: Uint8Array) {
      const parsed = submissionSchema.safeParse(input);
      if (!UUID.test(coachId) || !parsed.success) return { ok: false, error: "invalid" } as const;
      const x = parsed.data;
      let normalized: Buffer | null = null;
      if (x.photoAction === "replace") {
        if (!photo || photo.length > COACH_PHOTO_MAX_BYTES || !deps.normalizePhoto || (normalized = await deps.normalizePhoto(photo)) === null)
          return { ok: false, error: "invalid_photo" } as const;
      } else if (photo?.length) return { ok: false, error: "invalid_photo" } as const;
      return inTransaction(database, async (within) => {
        const coach = (await within.query("SELECT id FROM human_coach WHERE id=$1 AND retired_at IS NULL FOR UPDATE", [coachId])).rows[0];
        if (!coach) return { ok: false, error: "not_found" } as const;
        await copyLegacy(within, [coachId]);
        const owner = (
          await within.query<{ id: string }>(`SELECT c.id FROM candidate c JOIN human_coach h ON h.email=lower(c.email) WHERE h.id=$1 AND c."emailVerified"`, [
            coachId,
          ])
        ).rows[0];
        if (!owner) return { ok: false, error: "not_found" } as const;
        const latest = (
          await within.query<{ revision: number; photo: Buffer | null }>(
            "SELECT revision,photo FROM coach_page_version WHERE coach_id=$1 ORDER BY revision DESC LIMIT 1",
            [coachId],
          )
        ).rows[0];
        const head = (await within.query<{ revision: number }>("SELECT public_profile_revision AS revision FROM human_coach WHERE id=$1", [coachId])).rows[0]!
          .revision;
        if (head !== x.basedOn) return { ok: false, error: "conflict" } as const;
        await within.query("UPDATE coach_page_version SET state='superseded' WHERE coach_id=$1 AND state='pending'", [coachId]);
        const chosen = x.photoAction === "replace" ? normalized : x.photoAction === "remove" ? null : (latest?.photo ?? null);
        await within.query("UPDATE human_coach SET public_profile_revision=$2 WHERE id=$1", [coachId, head + 1]);
        const row = (
          await within.query<{ id: string; revision: number }>(
            `INSERT INTO coach_page_version(owner_id,coach_id,revision,content,photo,state,locale,created_at,source) VALUES($7,$1,$2,$3::jsonb,$4,'pending',$5,$6,'coach') RETURNING id,revision`,
            [coachId, head + 1, JSON.stringify(x.content), chosen, x.locale, now(), owner.id],
          )
        ).rows[0]!;
        return { ok: true, ...row } as const;
      });
    },
    async queue() {
      return (
        await database.query<CoachPageVersion>(
          `SELECT ${COLUMNS} FROM coach_page_version p JOIN human_coach h ON h.id=p.coach_id AND h.retired_at IS NULL WHERE p.state='pending' ORDER BY p.created_at,p.id LIMIT 100`,
        )
      ).rows;
    },
    async decide(id: string, decision: unknown, reason: unknown, within?: Queryable) {
      if (!UUID.test(id) || !(decision === "approve" || decision === "refuse")) return { ok: false, error: "invalid" } as const;
      const refusal = typeof reason === "string" ? reason.trim() : "";
      if (decision === "refuse" && (refusal.length < 3 || refusal.length > 2000)) return { ok: false, error: "invalid" } as const;
      async function run(transaction: Queryable) {
        const owner = (await transaction.query<{ coachId: string }>('SELECT coach_id AS "coachId" FROM coach_page_version WHERE id=$1', [id])).rows[0];
        if (!owner) return { ok: false, error: "not_found" } as const;
        if (!(await transaction.query("SELECT id FROM human_coach WHERE id=$1 AND retired_at IS NULL FOR UPDATE", [owner.coachId])).rowCount)
          return { ok: false, error: "not_found" } as const;
        const record = (
          await transaction.query<CoachPageVersion>(
            `SELECT ${COLUMNS} FROM coach_page_version p JOIN human_coach h ON h.id=p.coach_id WHERE p.id=$1 FOR UPDATE OF p`,
            [id],
          )
        ).rows[0]!;
        if (record.state === "approved" || record.state === "refused") return { ok: true, changed: false, version: record } as const;
        if (
          record.state !== "pending" ||
          !(
            await transaction.query(
              "SELECT 1 FROM coach_page_version WHERE id=$1 AND revision=(SELECT max(revision) FROM coach_page_version WHERE coach_id=$2)",
              [id, record.coachId],
            )
          ).rowCount
        )
          return { ok: false, error: "stale" } as const;
        await transaction.query("UPDATE coach_page_version SET state=$2,reason=$3,decided_at=$4 WHERE id=$1", [
          id,
          decision === "approve" ? "approved" : "refused",
          decision === "refuse" ? refusal : null,
          now(),
        ]);
        if (decision === "approve")
          await transaction.query("UPDATE human_coach SET bio=$2,public_ready=true WHERE id=$1", [record.coachId, record.content.presentation]);
        return {
          ok: true,
          changed: true,
          version: {
            ...record,
            state: decision === "approve" ? ("approved" as const) : ("refused" as const),
            reason: decision === "refuse" ? refusal : null,
            decidedAt: now(),
          },
        } as const;
      }
      return within ? run(within) : inTransaction(database, run);
    },
    async deliverNotices(limit = 25) {
      if (!deps.sendDecision) return 0;
      let sent = 0;
      for (let i = 0; i < limit; i++) {
        const row = (
          await database.query<CoachPageVersion & { claim: string }>(
            `UPDATE coach_page_version p SET notice_claim=gen_random_uuid(),notice_claimed_at=$1 FROM human_coach h WHERE h.id=p.coach_id AND p.id=(SELECT q.id FROM coach_page_version q JOIN human_coach qh ON qh.id=q.coach_id AND qh.retired_at IS NULL WHERE q.state IN ('approved','refused') AND q.source='coach' AND q.notice_sent_at IS NULL AND (q.notice_retry_at IS NULL OR q.notice_retry_at<=$1) AND (q.notice_claimed_at IS NULL OR q.notice_claimed_at<$1::timestamptz-interval '5 minutes') ORDER BY q.decided_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1) RETURNING ${COLUMNS},p.notice_claim AS claim`,
            [now()],
          )
        ).rows[0];
        if (!row) break;
        try {
          await deps.sendDecision(row);
          await database.query("UPDATE coach_page_version SET notice_sent_at=$3,notice_claim=NULL,notice_claimed_at=NULL WHERE id=$1 AND notice_claim=$2", [
            row.id,
            row.claim,
            now(),
          ]);
          sent++;
        } catch {
          await database.query(
            "UPDATE coach_page_version SET notice_claim=NULL,notice_claimed_at=NULL,notice_retry_at=$3::timestamptz+interval '5 minutes' WHERE id=$1 AND notice_claim=$2",
            [row.id, row.claim, now()],
          );
        }
      }
      return sent;
    },
    async purge() {
      return (
        (
          await database.query(
            "DELETE FROM coach_page_version p USING human_coach h WHERE p.coach_id=h.id AND ((p.state IN ('refused','superseded') AND p.created_at<$1::timestamptz-interval '6 months') OR h.retired_at<$1::timestamptz-interval '6 months')",
            [now()],
          )
        ).rowCount ?? 0
      );
    },
  };
}
export async function coachPagesOf(database: Queryable, candidateId: string) {
  const rows = (
    await database.query<CoachPageVersion>(
      `SELECT ${COLUMNS} FROM coach_page_version p JOIN human_coach h ON h.id=p.coach_id JOIN candidate c ON c.id=p.owner_id OR (p.owner_id IS NULL AND p.source='legacy_bio' AND h.retired_at IS NULL AND lower(c.email)=h.email AND c."emailVerified") WHERE c.id=$1 ORDER BY p.coach_id,p.revision`,
      [candidateId],
    )
  ).rows;
  return rows.map(({ photo, ...row }) => ({ ...row, photo: photo ? { contentType: "image/webp", base64: photo.toString("base64") } : null }));
}
/** Publication ends with the account; professional/session identities remain as retired history. */
export async function deleteCoachPagesOf(database: Queryable, candidateId: string) {
  await database.query(
    `DELETE FROM coach_page_version p USING human_coach h,candidate c WHERE p.coach_id=h.id AND c.id=$1 AND (p.owner_id=c.id OR (p.owner_id IS NULL AND p.source='legacy_bio' AND h.retired_at IS NULL AND c."emailVerified" AND h.email=lower(c.email)))`,
    [candidateId],
  );
  await database.query(
    `UPDATE human_coach h SET retired_at=clock_timestamp(),public_ready=false,bio='' FROM candidate c WHERE c.id=$1 AND c."emailVerified" AND h.email=lower(c.email) AND h.retired_at IS NULL`,
    [candidateId],
  );
}
export async function migrateCoachPages(database: Pool) {
  await database.query(`ALTER TABLE human_coach ADD COLUMN IF NOT EXISTS public_profile_revision integer NOT NULL DEFAULT 0;
 CREATE TABLE IF NOT EXISTS coach_page_version(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id text REFERENCES candidate(id) ON DELETE CASCADE,coach_id uuid NOT NULL REFERENCES human_coach(id),revision integer NOT NULL,content jsonb NOT NULL,photo bytea,state text NOT NULL CHECK(state IN ('pending','approved','refused','superseded')),reason text,locale text NOT NULL,source text NOT NULL CHECK(source IN ('legacy_bio','coach')),created_at timestamptz NOT NULL,decided_at timestamptz,notice_claim uuid,notice_claimed_at timestamptz,notice_retry_at timestamptz,notice_sent_at timestamptz,UNIQUE(coach_id,revision));
 CREATE INDEX IF NOT EXISTS coach_page_pending ON coach_page_version(created_at,id) WHERE state='pending';`);
  await copyLegacy(database);
}
