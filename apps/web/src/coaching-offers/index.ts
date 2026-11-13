/** Offers and Sellers (ADR-0095). Quote freezes the identity, price and Commission before payment. */
import { z } from "zod";
import type { Pool } from "pg";
import { JOBBBOX_SELLER, type CoachingSeller, type CoachingSale } from "@jobhub/shared/coaching-offers";
import type { Queryable } from "../database/pool";
export { JOBBBOX_SELLER, type CoachingSeller, type CoachingSale };
export interface CoachingOffer {
  id: string;
  coachId: string;
  seller: CoachingSeller;
  durationMinutes: number;
  amount: number | null;
  currency: string;
  commissionBps: number;
  coachShareBps?:number|null;
  payoutSellerId?:string|null;
}
export interface OfferDeps {
  price(candidateId: string): Promise<{ amount: number; currency: string; priceId?: string } | null>;
  /** Third-party payment and legal eligibility; absent until Connect and rollout gates are implemented. */
  eligiblePlatformOffer?(coachId:string):Promise<boolean>;
  eligibleSeller?(sellerId: string): Promise<boolean>;
}
const sellerInput = z.object({
  id: z.uuid().optional(),
  kind: z.enum(["human_coach", "association"]),
  name: z.string().trim().min(1).max(160),
  status: z.string().trim().min(1).max(120),
  siret: z.string().regex(/^\d{14}$/),
  coachId: z.uuid().nullable().default(null),
  commissionBps: z.number().int().min(0).max(10000),
});
const offerInput = z.object({
  coachId: z.uuid(),
  sellerId: z.uuid(),
  durationMinutes: z.number().int().min(15).max(480),
  amount: z.number().int().min(50).max(1_000_000).nullable(),
  currency: z.literal("eur").default("eur"),
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Row {
  id: string;
  coachId: string;
  seller: CoachingSeller;
  durationMinutes: number;
  amount: number | null;
  currency: string;
  commissionBps: number;
  coachShareBps?:number|null;
  payoutSellerId?:string|null;
}
const COLUMNS = `o.id,o.coach_id AS "coachId",o.duration_minutes AS "durationMinutes",o.amount,o.currency,o.coach_share_bps AS "coachShareBps",o.payout_seller_id AS "payoutSellerId",s.commission_bps AS "commissionBps",jsonb_build_object('id',s.id,'kind',s.kind,'name',s.name,'status',s.status,'siret',s.siret) AS seller`;
export function coachingOffers(database: Pool, deps: OfferDeps) {
  async function platformPrice(candidateId: string) {
    try {
      return await deps.price(candidateId);
    } catch {
      return null;
    }
  }
  async function defaults(within: Queryable = database) {
    await within.query("INSERT INTO coaching_offer (coach_id,seller_id) SELECT id,$1 FROM human_coach ON CONFLICT(coach_id) DO NOTHING", [JOBBBOX_SELLER.id]);
  }
  async function offer(coachId: string): Promise<CoachingOffer | null> {
    if (!UUID.test(coachId)) return null;
    await defaults();
    const { rows } = await database.query<Row>(
      `SELECT ${COLUMNS} FROM coaching_offer o JOIN coaching_seller s ON s.id=o.seller_id JOIN human_coach h ON h.id=o.coach_id AND h.retired_at IS NULL WHERE o.coach_id=$1 AND NOT EXISTS(SELECT 1 FROM coaching_content_case m WHERE m.coach_id=h.id AND m.outcome IN ('remove','suspend'))`,
      [coachId],
    );
    return rows[0] ?? null;
  }
  async function sale(candidateId: string, coachId: string): Promise<CoachingSale | null> {
    const found = await offer(coachId);
    if (!found) return null;
    if(found.seller.kind==="jobbbox"&&deps.eligiblePlatformOffer&&!await deps.eligiblePlatformOffer(coachId))return null;
    if (found.seller.kind !== "jobbbox" && !(await deps.eligibleSeller?.(found.seller.id))) return null;
    const price =
      found.seller.kind === "jobbbox" ? await platformPrice(candidateId) : found.amount === null ? null : { amount: found.amount, currency: found.currency };
    return price
      ? {
          offerId: found.id,
          coachId,
          seller: found.seller,
          durationMinutes: found.durationMinutes,
          amount: price.amount,
          currency: price.currency,
          commissionBps: found.commissionBps,
        }
      : null;
  }
  return {
    offer,
    sale,
    async all(): Promise<CoachingOffer[]> {
      await defaults();
      return (
        await database.query<Row>(
          `SELECT ${COLUMNS} FROM coaching_offer o JOIN coaching_seller s ON s.id=o.seller_id JOIN human_coach h ON h.id=o.coach_id AND h.retired_at IS NULL ORDER BY h.name,o.id`,
        )
      ).rows;
    },
    async sellers(): Promise<(CoachingSeller & { commissionBps: number; coachId: string | null })[]> {
      return (
        await database.query(
          `SELECT id,kind,name,status,siret,commission_bps AS "commissionBps",coach_id AS "coachId" FROM coaching_seller ORDER BY kind,name,id`,
        )
      ).rows;
    },
    async saveSeller(input: unknown, within: Queryable = database) {
      const parsed = sellerInput.safeParse(input);
      if (!parsed.success) return null;
      const x = parsed.data;
      if ((x.kind === "human_coach" && !x.coachId) || (x.kind === "association" && x.coachId)) return null;
      const { rows } = await within.query<CoachingSeller & {commissionBps:number;coachId:string|null}>(
        `INSERT INTO coaching_seller(id,kind,name,status,siret,coach_id,commission_bps) VALUES(coalesce($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6,$7)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,status=EXCLUDED.status,siret=EXCLUDED.siret,commission_bps=EXCLUDED.commission_bps WHERE coaching_seller.kind=EXCLUDED.kind AND coaching_seller.coach_id IS NOT DISTINCT FROM EXCLUDED.coach_id RETURNING id,kind,name,status,siret,commission_bps AS "commissionBps",coach_id AS "coachId"`,
        [x.id ?? null, x.kind, x.name, x.status, x.siret, x.coachId, x.commissionBps],
      );
      return rows[0] ?? null;
    },
    async compensation(coachId:string,basisPoints:number|null,payoutSellerId:string|null,within:Queryable=database){
      if(!UUID.test(coachId)||(payoutSellerId!==null&&!UUID.test(payoutSellerId))||(basisPoints!==null&&(!Number.isInteger(basisPoints)||basisPoints<0||basisPoints>10000)))return false;
      return (await within.query(`UPDATE coaching_offer o SET coach_share_bps=$2,payout_seller_id=$3 WHERE o.coach_id=$1 AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM coaching_seller s WHERE s.id=$3 AND ((s.kind='human_coach' AND s.coach_id=o.coach_id) OR (s.kind='association' AND EXISTS(SELECT 1 FROM coach_association_coach m WHERE m.association_id=s.association_id AND m.coach_id=o.coach_id AND m.removed_at IS NULL)))))`,[coachId,basisPoints,payoutSellerId])).rowCount===1;
    },
    async commission(sellerId: string, basisPoints: number, within: Queryable = database) {
      if (!UUID.test(sellerId) || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) return false;
      return (await within.query("UPDATE coaching_seller SET commission_bps=$2 WHERE id=$1", [sellerId, basisPoints])).rowCount === 1;
    },
    async saveOffer(input: unknown, within: Queryable = database) {
      const parsed = offerInput.safeParse(input);
      if (!parsed.success) return false;
      const x = parsed.data;
      // A coach may sell their own offer; an Association may be the Seller of member offers (#876 enforces membership).
      const result = await within.query(
        `INSERT INTO coaching_offer(coach_id,seller_id,duration_minutes,amount,currency)
        SELECT h.id,s.id,$3,$4,$5 FROM human_coach h,coaching_seller s WHERE h.id=$1 AND h.retired_at IS NULL AND s.id=$2 AND (s.kind!='human_coach' OR s.coach_id=h.id) AND (s.kind='jobbbox' OR $4::integer IS NOT NULL) AND (s.kind!='association' OR EXISTS(SELECT 1 FROM coach_association a JOIN coach_association_coach m ON m.association_id=a.id WHERE a.id=s.association_id AND a.retired_at IS NULL AND m.coach_id=h.id AND m.removed_at IS NULL))
        ON CONFLICT(coach_id) DO UPDATE SET seller_id=EXCLUDED.seller_id,duration_minutes=EXCLUDED.duration_minutes,amount=EXCLUDED.amount,currency=EXCLUDED.currency`,
        [x.coachId, x.sellerId, x.durationMinutes, x.amount, x.currency],
      );
      return result.rowCount === 1;
    },
    async quote(candidateId: string, coachId: string): Promise<{ id: string; sale: CoachingSale; priceId?: string } | null> {
      let snapshot = await sale(candidateId, coachId);
      if (!snapshot) return null;
      const price = snapshot.seller.kind === "jobbbox" ? await platformPrice(candidateId) : null;
      if (snapshot.seller.kind === "jobbbox" && !price) return null;
      if (price) snapshot = { ...snapshot, amount: price.amount, currency: price.currency };
      const { rows } = await database.query<{ id: string }>(
        "INSERT INTO coaching_offer_quote(candidate_id,coach_id,snapshot) VALUES($1,$2,$3::jsonb) RETURNING id",
        [candidateId, coachId, JSON.stringify(snapshot)],
      );
      return { id: rows[0]!.id, sale: snapshot, ...(price?.priceId ? { priceId: price.priceId } : {}) };
    },
    async attachPaid(paid: { candidateId: string; coachId: string; checkoutSessionId: string; quoteId?: string; amount: number; currency: string }, within:Queryable=database) {
      if (paid.quoteId) {
        if (!UUID.test(paid.quoteId)) throw new Error("Invalid paid Coaching Offer quote");
        await within.query(
          `INSERT INTO coaching_session_sale(session_id,snapshot,source) SELECT s.id,q.snapshot,'quote' FROM coaching_session s JOIN coaching_offer_quote q ON q.id=$1 AND q.candidate_id=s.candidate_id AND q.coach_id=s.coach_id AND q.created_at<=s.paid_at
          WHERE s.stripe_checkout_session_id=$2 AND s.candidate_id=$3 AND s.coach_id=$4 AND (q.snapshot->>'amount')::integer=$5 AND q.snapshot->>'currency'=$6
          ON CONFLICT(session_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,source='quote' WHERE coaching_session_sale.source='legacy_backfill'`,
          [paid.quoteId, paid.checkoutSessionId, paid.candidateId, paid.coachId, paid.amount, paid.currency.toLowerCase()],
        );
      } else {
        // Pre-Offer Checkout sessions remain Jobbbox sales with their actual paid price.
        await defaults(within);
        await within.query(
          `INSERT INTO coaching_session_sale(session_id,snapshot,source) SELECT s.id,jsonb_build_object('offerId',o.id,'coachId',s.coach_id,'seller',$4::jsonb,'durationMinutes',coalesce(s.duration_minutes,60),'amount',s.amount,'currency',s.currency,'commissionBps',0),'legacy_payment' FROM coaching_session s JOIN coaching_offer o ON o.coach_id=s.coach_id WHERE s.stripe_checkout_session_id=$1 AND s.candidate_id=$2 AND s.coach_id=$3 ON CONFLICT DO NOTHING`,
          [paid.checkoutSessionId, paid.candidateId, paid.coachId, JSON.stringify(JOBBBOX_SELLER)],
        );
      }
      const result = await within.query(
        `UPDATE coaching_session s SET duration_minutes=CASE WHEN s.scheduled_at IS NULL THEN (x.snapshot->>'durationMinutes')::integer ELSE coalesce(s.duration_minutes,(x.snapshot->>'durationMinutes')::integer) END FROM coaching_session_sale x WHERE x.session_id=s.id AND s.stripe_checkout_session_id=$1 AND s.candidate_id=$2 AND s.coach_id=$3 AND ($4::uuid IS NULL OR x.snapshot=(SELECT snapshot FROM coaching_offer_quote WHERE id=$4))`,
        [paid.checkoutSessionId, paid.candidateId, paid.coachId, paid.quoteId??null],
      );
      if (!result.rowCount) throw new Error("Paid Coaching Offer quote does not match its session");
    },
  };
}
export async function migrateCoachingOffers(database: Pool) {
  await database.query(`CREATE TABLE IF NOT EXISTS coaching_seller(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('jobbbox','human_coach','association')),name text NOT NULL,status text NOT NULL DEFAULT '',siret text NOT NULL DEFAULT '',coach_id uuid REFERENCES human_coach(id),commission_bps integer NOT NULL DEFAULT 0 CHECK(commission_bps BETWEEN 0 AND 10000));
  CREATE UNIQUE INDEX IF NOT EXISTS coaching_seller_jobbox_idx ON coaching_seller(kind) WHERE kind='jobbbox';
  CREATE UNIQUE INDEX IF NOT EXISTS coaching_seller_coach_idx ON coaching_seller(coach_id) WHERE kind='human_coach';
  INSERT INTO coaching_seller(id,kind,name) VALUES('${JOBBBOX_SELLER.id}','jobbbox','Jobbbox') ON CONFLICT DO NOTHING;
  CREATE TABLE IF NOT EXISTS coaching_offer(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),coach_id uuid NOT NULL UNIQUE REFERENCES human_coach(id),seller_id uuid NOT NULL REFERENCES coaching_seller(id),duration_minutes integer NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 15 AND 480),amount integer CHECK(amount>=50),currency text NOT NULL DEFAULT 'eur');
  ALTER TABLE coaching_offer ADD COLUMN IF NOT EXISTS coach_share_bps integer CHECK(coach_share_bps BETWEEN 0 AND 10000);
  ALTER TABLE coaching_offer ADD COLUMN IF NOT EXISTS payout_seller_id uuid REFERENCES coaching_seller(id);
  INSERT INTO coaching_offer(coach_id,seller_id) SELECT id,'${JOBBBOX_SELLER.id}' FROM human_coach ON CONFLICT(coach_id) DO NOTHING;
  CREATE TABLE IF NOT EXISTS coaching_offer_quote(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),candidate_id text NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,coach_id uuid NOT NULL REFERENCES human_coach(id),snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
  CREATE INDEX IF NOT EXISTS coaching_offer_quote_candidate_idx ON coaching_offer_quote(candidate_id);
  CREATE TABLE IF NOT EXISTS coaching_session_sale(session_id uuid PRIMARY KEY REFERENCES coaching_session(id) ON DELETE CASCADE,snapshot jsonb NOT NULL,source text NOT NULL DEFAULT 'quote');
  ALTER TABLE coaching_session_sale ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'quote';
  ALTER TABLE checkout_order ADD COLUMN IF NOT EXISTS coaching_sale jsonb;
  INSERT INTO coaching_session_sale(session_id,snapshot,source) SELECT s.id,jsonb_build_object('offerId',o.id,'coachId',s.coach_id,'seller',jsonb_build_object('id','${JOBBBOX_SELLER.id}','kind','jobbbox','name','Jobbbox','status','','siret',''),'durationMinutes',coalesce(s.duration_minutes,60),'amount',s.amount,'currency',s.currency,'commissionBps',0),'legacy_backfill' FROM coaching_session s JOIN coaching_offer o ON o.coach_id=s.coach_id WHERE s.coaching_quote_id IS NULL AND NOT EXISTS (SELECT 1 FROM checkout_order ordered WHERE ordered.checkout_session_id=s.stripe_checkout_session_id AND ordered.coaching_sale IS NOT NULL) ON CONFLICT DO NOTHING;`);
}
