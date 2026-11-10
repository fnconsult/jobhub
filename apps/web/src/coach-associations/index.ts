/** An Association manages business identities and offers, never the Candidates coached by its members (ADR-0099). */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import { JOBBBOX_SELLER } from "@jobhub/shared/coaching-offers";
/** Proposed operational audit retention; legal validation remains #890. */
export const ASSOCIATION_ACTIVITY_YEARS = 2;
export interface AssociationPerson {
  id: string;
  email: string;
  emailVerified: boolean;
}
export interface Association {
  id: string;
  name: string;
  status: string;
  siret: string;
}
export interface Invitation {
  id: string;
  associationId: string;
  associationName: string;
  role: "coach" | "manager";
  name: string;
  email: string;
  locale: "fr" | "en";
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
}
export interface AssociationDeps {
  secret: string;
  /** Both current membership and acceptance of this Association's effective contract are required. */
  mayManage(person: AssociationPerson, associationId: string): Promise<boolean>;
  sendInvitation?(invitation: Invitation, token: string): Promise<void>;
  now?: () => Date;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const input = z.object({
  role: z.enum(["coach", "manager"]),
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  locale: z.enum(["fr", "en"]).default("fr"),
});
const INVITE = `i.id,i.association_id AS "associationId",a.name AS "associationName",i.role,i.name,i.email,i.locale,i.created_at AS "createdAt",i.expires_at AS "expiresAt",i.accepted_at AS "acceptedAt",i.cancelled_at AS "cancelledAt"`;
export function coachAssociations(database: Pool, deps: AssociationDeps) {
  const now = deps.now ?? (() => new Date());
  function tokenOf(id: string) {
    if (!deps.secret) throw new Error("Association invitations require AUTH_SECRET");
    return createHmac("sha256", deps.secret).update(`association-invitation:${id}`).digest("hex");
  }
  function validToken(id: string, token: unknown) {
    return (
      UUID.test(id) && typeof token === "string" && /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(tokenOf(id), "hex"))
    );
  }
  async function managed(person: AssociationPerson, within: Queryable = database): Promise<Association[]> {
    if (!person.emailVerified) return [];
    return (
      await within.query<Association>(
        `SELECT a.id,a.name,a.legal_status AS status,a.siret FROM coach_association a JOIN coach_association_manager m ON m.association_id=a.id JOIN candidate c ON c.id=m.candidate_id WHERE m.candidate_id=$1 AND lower(c.email)=$2 AND c."emailVerified" AND a.retired_at IS NULL ORDER BY a.name,a.id`,
        [person.id, person.email.trim().toLowerCase()],
      )
    ).rows;
  }
  async function authorized(person: AssociationPerson, id: string, within: Queryable = database) {
    return UUID.test(id) && (await managed(person, within)).some((a) => a.id === id) && (await deps.mayManage(person, id));
  }
  async function activity(within: Queryable, associationId: string, person: AssociationPerson, action: string, subjectId: string) {
    await within.query("INSERT INTO coach_association_activity(association_id,actor_id,action,subject_id,created_at) VALUES($1,$2,$3,$4,$5)", [
      associationId,
      person.id,
      action,
      subjectId,
      now(),
    ]);
  }
  async function invitation(person: AssociationPerson, id: string, token: unknown, within: Queryable = database): Promise<Invitation | null> {
    if (!person.emailVerified || !validToken(id, token)) return null;
    return (
      (
        await within.query<Invitation>(
          `SELECT ${INVITE} FROM coach_association_invitation i JOIN coach_association a ON a.id=i.association_id AND a.retired_at IS NULL WHERE i.id=$1 AND i.email=$2 AND i.cancelled_at IS NULL AND i.expires_at>$3`,
          [id, person.email.trim().toLowerCase(), now()],
        )
      ).rows[0] ?? null
    );
  }
  async function seller(id: string, within: Queryable) {
    // Bind the already approved business identity; keep any administrator-set Commission on an existing Seller.
    await within.query(
      `UPDATE coaching_seller SET association_id=$1 WHERE id=(SELECT s.id FROM coaching_seller s JOIN coach_association a ON a.siret=s.siret WHERE a.id=$1 AND s.kind='association' AND s.association_id IS NULL ORDER BY s.id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM coaching_seller WHERE association_id=$1)`,
      [id],
    );
    return (
      (
        await within.query<{ id: string }>(
          `INSERT INTO coaching_seller(kind,name,status,siret,association_id,commission_bps) SELECT 'association',name,legal_status,siret,id,0 FROM coach_association WHERE id=$1 AND retired_at IS NULL ON CONFLICT(association_id) DO UPDATE SET association_id=EXCLUDED.association_id RETURNING id`,
          [id],
        )
      ).rows[0]?.id ?? null
    );
  }
  return {
    managed,
    authorized,
    invitation,
    async invite(person: AssociationPerson, associationId: string, value: unknown) {
      const parsed = input.safeParse(value);
      if (!parsed.success) return { ok: false, error: "invalid" } as const;
      if (!(await authorized(person, associationId))) return { ok: false, error: "not_found" } as const;
      return inTransaction(database, async (within) => {
        if (!(await authorized(person, associationId, within))) return { ok: false, error: "not_found" } as const;
        await within.query("SELECT id FROM coach_association WHERE id=$1 AND retired_at IS NULL FOR UPDATE", [associationId]);
        const x = parsed.data;
        await within.query(
          "UPDATE coach_association_invitation SET cancelled_at=$3 WHERE association_id=$1 AND email=$2 AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at<=$3",
          [associationId, x.email, now()],
        );
        const existing = (
          await within.query<{ id: string }>(
            `SELECT id FROM coach_association_invitation WHERE association_id=$1 AND email=$2 AND accepted_at IS NULL AND cancelled_at IS NULL`,
            [associationId, x.email],
          )
        ).rows[0];
        if (existing) return { ok: true, id: existing.id } as const;
        const id = (
          await within.query<{ id: string }>(
            `INSERT INTO coach_association_invitation(association_id,invited_by,role,name,email,locale,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7::timestamptz+interval '7 days') RETURNING id`,
            [associationId, person.id, x.role, x.name, x.email, x.locale, now()],
          )
        ).rows[0]!.id;
        await activity(within, associationId, person, "invited", id);
        return { ok: true, id } as const;
      });
    },
    async accept(person: AssociationPerson, id: string, token: unknown) {
      const initial = await invitation(person, id, token);
      if (!initial) return { ok: false, error: "not_found" } as const;
      return inTransaction(database, async (within) => {
        await within.query("SELECT id FROM coach_association WHERE id=$1 FOR UPDATE", [initial.associationId]);
        await within.query("SELECT id FROM coach_association_invitation WHERE id=$1 FOR UPDATE", [id]);
        const record = await invitation(person, id, token, within);
        if (!record) return { ok: false, error: "not_found" } as const;
        const association = (await within.query(`SELECT id FROM coach_association WHERE id=$1 AND retired_at IS NULL FOR UPDATE`, [record.associationId]))
          .rows[0];
        if (!association) return { ok: false, error: "not_found" } as const;
        const inviter = (
          await within.query<AssociationPerson>(
            `SELECT c.id,c.email,c."emailVerified" FROM candidate c JOIN coach_association_invitation i ON i.invited_by=c.id WHERE i.id=$1`,
            [id],
          )
        ).rows[0];
        if (!inviter || !(await authorized(inviter, record.associationId, within))) return { ok: false, error: "not_found" } as const;
        if (record.acceptedAt) {
          const exists =
            record.role === "manager"
              ? await within.query("SELECT 1 FROM coach_association_manager WHERE association_id=$1 AND candidate_id=$2", [record.associationId, person.id])
              : await within.query(
                  "SELECT 1 FROM coach_association_coach m JOIN human_coach h ON h.id=m.coach_id WHERE m.association_id=$1 AND h.email=$2 AND m.removed_at IS NULL AND h.retired_at IS NULL",
                  [record.associationId, record.email],
                );
          return exists.rowCount ? ({ ok: true, role: record.role } as const) : ({ ok: false, error: "not_found" } as const);
        }
        if (record.role === "manager") {
          await within.query("INSERT INTO coach_association_manager(association_id,candidate_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [
            record.associationId,
            person.id,
          ]);
        } else {
          // A verified recipient explicitly joins; an independent Coach can join, never be silently moved from another Association.
          await within.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`association-coach:${record.email}`]);
          let coach = (await within.query<{ id: string }>("SELECT id FROM human_coach WHERE email=$1 AND retired_at IS NULL FOR UPDATE", [record.email]))
            .rows[0];
          if (
            coach &&
            (
              await within.query("SELECT 1 FROM coach_association_coach WHERE coach_id=$1 AND association_id<>$2 AND removed_at IS NULL", [
                coach.id,
                record.associationId,
              ])
            ).rowCount
          )
            return { ok: false, error: "conflict" } as const;
          if (!coach)
            coach = (
              await within.query<{ id: string }>(
                "INSERT INTO human_coach(name,email,booking_url,contract_pending,public_ready) VALUES($1,$2,'',true,false) ON CONFLICT(email) WHERE retired_at IS NULL DO UPDATE SET email=EXCLUDED.email RETURNING id",
                [record.name, record.email],
              )
            ).rows[0]!;
          await within.query(
            "INSERT INTO coach_association_coach(association_id,coach_id,joined_at) VALUES($1,$2,$3) ON CONFLICT(association_id,coach_id) DO NOTHING",
            [record.associationId, coach.id, now()],
          );
        }
        await within.query("UPDATE coach_association_invitation SET accepted_at=$2,recipient_id=$3 WHERE id=$1", [id, now(), person.id]);
        await activity(within, record.associationId, person, "accepted_invitation", id);
        return { ok: true, role: record.role } as const;
      });
    },
    async cancelInvitation(person: AssociationPerson, associationId: string, id: string) {
      if (!UUID.test(id) || !(await authorized(person, associationId))) return false;
      return (
        (
          await database.query(
            "UPDATE coach_association_invitation SET cancelled_at=$3 WHERE id=$1 AND association_id=$2 AND accepted_at IS NULL AND cancelled_at IS NULL",
            [id, associationId, now()],
          )
        ).rowCount === 1
      );
    },
    async coaches(person: AssociationPerson, associationId: string) {
      if (!(await authorized(person, associationId))) return null;
      return (
        await database.query<{ id: string; name: string; email: string; bio: string; joinedAt: Date; retiredAt: Date | null; contractPending: boolean }>(
          `SELECT h.id,h.name,h.email,h.bio,m.joined_at AS "joinedAt",h.retired_at AS "retiredAt",h.contract_pending AS "contractPending" FROM coach_association_coach m JOIN human_coach h ON h.id=m.coach_id WHERE m.association_id=$1 ORDER BY h.retired_at NULLS FIRST,h.name,h.id`,
          [associationId],
        )
      ).rows;
    },
    async members(person: AssociationPerson, associationId: string) {
      if (!(await authorized(person, associationId))) return null;
      return (
        await database.query<{ id: string; name: string; email: string }>(
          `SELECT c.id,c.name,c.email FROM coach_association_manager m JOIN candidate c ON c.id=m.candidate_id WHERE m.association_id=$1 ORDER BY c.name,c.id`,
          [associationId],
        )
      ).rows;
    },
    async invitations(person: AssociationPerson, associationId: string) {
      if (!(await authorized(person, associationId))) return null;
      return (
        await database.query<Invitation>(
          `SELECT ${INVITE} FROM coach_association_invitation i JOIN coach_association a ON a.id=i.association_id WHERE i.association_id=$1 AND i.accepted_at IS NULL AND i.cancelled_at IS NULL AND i.expires_at>$2 ORDER BY i.created_at,i.id`,
          [associationId, now()],
        )
      ).rows;
    },
    async retireCoach(person: AssociationPerson, associationId: string, coachId: string) {
      if (!UUID.test(coachId) || !(await authorized(person, associationId))) return false;
      return inTransaction(database, async (within) => {
        await within.query("SELECT id FROM coach_association WHERE id=$1 FOR UPDATE", [associationId]);
        if (!(await authorized(person, associationId, within))) return false;
        const removed = await within.query(
          "UPDATE coach_association_coach SET removed_at=$3 WHERE association_id=$1 AND coach_id=$2 AND removed_at IS NULL RETURNING coach_id",
          [associationId, coachId, now()],
        );
        if (!removed.rowCount) return false;
        await within.query("UPDATE human_coach SET retired_at=$2 WHERE id=$1 AND retired_at IS NULL", [coachId, now()]);
        await activity(within, associationId, person, "retired_coach", coachId);
        return true;
      });
    },
    async offers(person: AssociationPerson, associationId: string) {
      if (!(await authorized(person, associationId))) return null;
      return inTransaction(database, async (within) => {
        const sellerId = (await within.query<{ id: string }>("SELECT id FROM coaching_seller WHERE association_id=$1", [associationId])).rows[0]?.id ?? null;
        return {
          sellerId,
          offers: (
            await within.query<{
              coachId: string;
              name: string;
              sellerId: string | null;
              sellerName: string | null;
              durationMinutes: number;
              amount: number | null;
              currency: string;
            }>(
              `SELECT h.id AS "coachId",h.name,o.seller_id AS "sellerId",s.name AS "sellerName",coalesce(o.duration_minutes,60) AS "durationMinutes",o.amount,coalesce(o.currency,'eur') AS currency FROM coach_association_coach m JOIN human_coach h ON h.id=m.coach_id AND h.retired_at IS NULL LEFT JOIN coaching_offer o ON o.coach_id=h.id LEFT JOIN coaching_seller s ON s.id=o.seller_id WHERE m.association_id=$1 AND m.removed_at IS NULL ORDER BY h.name,h.id`,
              [associationId],
            )
          ).rows,
        };
      });
    },
    async saveOffer(person: AssociationPerson, associationId: string, value: unknown) {
      const parsed = z
        .object({
          coachId: z.uuid(),
          seller: z.enum(["association", "jobbbox"]),
          durationMinutes: z.number().int().min(15).max(480),
          amount: z.number().int().min(50).max(1_000_000).nullable(),
        })
        .safeParse(value);
      if (!parsed.success || !(await authorized(person, associationId))) return false;
      return inTransaction(database, async (within) => {
        await within.query("SELECT id FROM coach_association WHERE id=$1 FOR UPDATE", [associationId]);
        if (!(await authorized(person, associationId, within))) return false;
        const x = parsed.data;
        if (x.seller === "association" && x.amount === null) return false;
        const sellerId = x.seller === "jobbbox" ? JOBBBOX_SELLER.id : await seller(associationId, within);
        if (!sellerId) return false;
        const changed = await within.query(
          `INSERT INTO coaching_offer(coach_id,seller_id,duration_minutes,amount,currency) SELECT h.id,$3,$4,$5,'eur' FROM human_coach h JOIN coach_association_coach m ON m.coach_id=h.id WHERE h.id=$2 AND h.retired_at IS NULL AND m.association_id=$1 AND m.removed_at IS NULL ON CONFLICT(coach_id) DO UPDATE SET seller_id=EXCLUDED.seller_id,duration_minutes=EXCLUDED.duration_minutes,amount=EXCLUDED.amount`,
          [associationId, x.coachId, sellerId, x.durationMinutes, x.seller === "association" ? x.amount : null],
        );
        if (changed.rowCount) await activity(within, associationId, person, "offer_changed", x.coachId);
        return changed.rowCount === 1;
      });
    },
    async providers(coachIds: string[]) {
      const ids = coachIds.filter((x) => UUID.test(x));
      if (!ids.length) return [];
      return (
        await database.query<{ coachId: string; id: string; name: string }>(
          `SELECT m.coach_id AS "coachId",a.id,a.name FROM coach_association_coach m JOIN coach_association a ON a.id=m.association_id AND a.retired_at IS NULL WHERE m.coach_id=ANY($1::uuid[]) AND m.removed_at IS NULL`,
          [ids],
        )
      ).rows;
    },
    async deliverInvitations(limit = 25) {
      if (!deps.sendInvitation) return 0;
      let sent = 0;
      for (let i = 0; i < limit; i++) {
        const row = (
          await database.query<Invitation & { claim: string }>(
            `UPDATE coach_association_invitation i SET notice_claim=gen_random_uuid(),notice_claimed_at=$1 FROM coach_association a WHERE a.id=i.association_id AND i.id=(SELECT q.id FROM coach_association_invitation q JOIN coach_association b ON b.id=q.association_id AND b.retired_at IS NULL WHERE q.accepted_at IS NULL AND q.cancelled_at IS NULL AND q.expires_at>$1 AND q.notice_sent_at IS NULL AND (q.notice_retry_at IS NULL OR q.notice_retry_at<=$1) AND (q.notice_claimed_at IS NULL OR q.notice_claimed_at<$1::timestamptz-interval '5 minutes') ORDER BY q.created_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1) RETURNING ${INVITE},i.notice_claim AS claim`,
            [now()],
          )
        ).rows[0];
        if (!row) break;
        const inviter = (
          await database.query<AssociationPerson>(
            `SELECT c.id,c.email,c."emailVerified" FROM candidate c JOIN coach_association_invitation i ON i.invited_by=c.id WHERE i.id=$1`,
            [row.id],
          )
        ).rows[0];
        if (!inviter || !(await authorized(inviter, row.associationId))) {
          await database.query(
            "UPDATE coach_association_invitation SET cancelled_at=$2,notice_claim=NULL,notice_claimed_at=NULL WHERE id=$1 AND notice_claim=$3",
            [row.id, now(), row.claim],
          );
          continue;
        }
        if (!deps.secret) throw new Error("Association invitations require AUTH_SECRET");
        try {
          await deps.sendInvitation(row, tokenOf(row.id));
          await database.query(
            "UPDATE coach_association_invitation SET notice_sent_at=$3,notice_claim=NULL,notice_claimed_at=NULL WHERE id=$1 AND notice_claim=$2",
            [row.id, row.claim, now()],
          );
          sent++;
        } catch {
          await database.query(
            "UPDATE coach_association_invitation SET notice_claim=NULL,notice_claimed_at=NULL,notice_retry_at=$3::timestamptz+interval '5 minutes' WHERE id=$1 AND notice_claim=$2",
            [row.id, row.claim, now()],
          );
        }
      }
      return sent;
    },
    async purge() {
      const invitations = await database.query("DELETE FROM coach_association_invitation WHERE expires_at<$1::timestamptz-interval '30 days'", [now()]);
      const activity = await database.query("DELETE FROM coach_association_activity WHERE created_at<$1::timestamptz-make_interval(years=>$2)", [
        now(),
        ASSOCIATION_ACTIVITY_YEARS,
      ]);
      return (invitations.rowCount ?? 0) + (activity.rowCount ?? 0);
    },
  };
}
export async function migrateCoachAssociations(database: Pool) {
  await database.query(`CREATE TABLE IF NOT EXISTS coach_association_coach(association_id uuid NOT NULL REFERENCES coach_association(id),coach_id uuid NOT NULL REFERENCES human_coach(id),joined_at timestamptz NOT NULL,removed_at timestamptz,PRIMARY KEY(association_id,coach_id));
 CREATE UNIQUE INDEX IF NOT EXISTS coach_association_active_coach ON coach_association_coach(coach_id) WHERE removed_at IS NULL;
 ALTER TABLE coaching_seller ADD COLUMN IF NOT EXISTS association_id uuid REFERENCES coach_association(id);
 CREATE UNIQUE INDEX IF NOT EXISTS coaching_seller_association ON coaching_seller(association_id);
 CREATE TABLE IF NOT EXISTS coach_association_invitation(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),association_id uuid NOT NULL REFERENCES coach_association(id),invited_by text REFERENCES candidate(id) ON DELETE SET NULL,recipient_id text REFERENCES candidate(id) ON DELETE SET NULL,role text NOT NULL CHECK(role IN ('coach','manager')),name text NOT NULL,email text NOT NULL,locale text NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,accepted_at timestamptz,cancelled_at timestamptz,notice_claim uuid,notice_claimed_at timestamptz,notice_retry_at timestamptz,notice_sent_at timestamptz);
 CREATE UNIQUE INDEX IF NOT EXISTS coach_association_pending_invitation ON coach_association_invitation(association_id,email) WHERE accepted_at IS NULL AND cancelled_at IS NULL;
 CREATE TABLE IF NOT EXISTS coach_association_activity(id bigserial PRIMARY KEY,association_id uuid NOT NULL REFERENCES coach_association(id),actor_id text REFERENCES candidate(id) ON DELETE SET NULL,action text NOT NULL,subject_id uuid NOT NULL,created_at timestamptz NOT NULL);`);
}

/** Personal business activity only, never a coached Candidate or their notes. Invitation tokens are not stored. */
export async function associationDataOf(database: Queryable, candidateId: string) {
  const [coaches, received, sent, activity] = await Promise.all([
    database.query(
      `SELECT a.id AS "associationId",a.name,m.joined_at AS "joinedAt",m.removed_at AS "removedAt" FROM coach_association_coach m JOIN coach_association a ON a.id=m.association_id JOIN human_coach h ON h.id=m.coach_id JOIN candidate c ON lower(c.email)=h.email WHERE c.id=$1 AND c."emailVerified" ORDER BY m.joined_at,a.id`,
      [candidateId],
    ),
    database.query(
      `SELECT i.id,i.association_id AS "associationId",a.name AS "associationName",i.role,i.name,i.email,i.created_at AS "createdAt",i.expires_at AS "expiresAt",i.accepted_at AS "acceptedAt",i.cancelled_at AS "cancelledAt" FROM coach_association_invitation i JOIN coach_association a ON a.id=i.association_id JOIN candidate c ON (lower(c.email)=i.email AND c."emailVerified") OR c.id=i.recipient_id WHERE c.id=$1 ORDER BY i.created_at,i.id`,
      [candidateId],
    ),
    database.query(
      `SELECT id,association_id AS "associationId",role,created_at AS "createdAt",expires_at AS "expiresAt",accepted_at AS "acceptedAt",cancelled_at AS "cancelledAt" FROM coach_association_invitation WHERE invited_by=$1 ORDER BY created_at,id`,
      [candidateId],
    ),
    database.query(
      `SELECT association_id AS "associationId",action,subject_id AS "subjectId",created_at AS "createdAt" FROM coach_association_activity WHERE actor_id=$1 ORDER BY created_at,id`,
      [candidateId],
    ),
  ]);
  return { coachMemberships: coaches.rows, invitationsReceived: received.rows, invitationsSent: sent.rows, activity: activity.rows };
}
export { associationInvitationEmail } from "./email";
