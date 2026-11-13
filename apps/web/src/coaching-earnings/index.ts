/** Owned business statements. This reader shares the settlement calculation and never selects a Candidate identity. */
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import { coachingDay, coachingDayStart } from "@jobhub/shared/coaching-time";
import type { CoachingSeller, CoachingSale } from "@jobhub/shared/coaching-offers";
import { earningLine, monthlyEarnings, type Earning, type EarningLine } from "../coaching-connect/earnings";
export interface EarningsRow extends EarningLine {
  currency: string;
  coachName: string;
  sale: CoachingSale;
  payee: CoachingSeller | null;
  heldMonth: string | null;
}
export interface EarningsOffer {
  key: string;
  coachName: string;
  offerId: string;
  durationMinutes: number;
  seller: CoachingSeller;
  currency: string;
  sessionsHeld: number;
  payments: number;
  collected: number;
  commission: number;
  refunded: number;
  refundedCommission: number;
  processingFees: number;
  withheld: number;
  net: number;
}
export interface EarningsPayout {
  id: string;
  month: string;
  currency: string;
  amount: number;
  state: "pending" | "paid" | "failed" | "needs_review" | "cancelling" | "cancelled";
  createdAt: Date;
  paidAt: Date | null;
}
export interface EarningsCurrency {
  currency: string;
  payments: number;
  collected: number;
  commission: number;
  refunded: number;
  refundedCommission: number;
  processingFees: number;
  withheld: number;
  net: number;
  /** Net outstanding across all months, so a later refund of an old payout is not lost in a month filter. */
  outstanding: number;
  nextPayoutAt: Date | null;
}
export interface EarningsStatement {
  seller: CoachingSeller;
  beneficiaries: CoachingSeller[];
  month: string;
  generatedAt: Date;
  sessionsHeld: number;
  currencies: EarningsCurrency[];
  offers: EarningsOffer[];
  payouts: EarningsPayout[];
}
interface Stored extends Earning {
  currency: string;
  coachName: string;
  sale: CoachingSale;
  payee: CoachingSeller | null;
  heldMonth: string | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function earningsMonth(now = new Date()) {
  return coachingDay(now).slice(0, 7);
}
export function earningsPeriod(month: unknown): { month: string; start: Date; end: Date } | null {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const year = Number(month.slice(0, 4)),
    number = Number(month.slice(5));
  if (year < 1000 || year >= 9999) return null;
  const next = number === 12 ? `${String(year + 1).padStart(4, "0")}-01` : `${month.slice(0, 4)}-${String(number + 1).padStart(2, "0")}`;
  return { month, start: coachingDayStart(`${month}-01`), end: coachingDayStart(`${next}-01`) };
}
const inPeriod = (date: Date | null, period: { start: Date; end: Date }) => date !== null && date >= period.start && date < period.end;
const keyOf = (row: Stored) => `${row.sale.offerId}:${row.sale.seller.id}:${row.sale.durationMinutes}:${row.currency}`;
/** Same stable ownership as Account Data: retirement does not transfer old invoices to a recycled email. */
export async function mayReadEarnings(database: Queryable, personId: string, sellerId: string) {
  if (!UUID.test(sellerId)) return false;
  return !!(
    await database.query(
      `SELECT 1 FROM coaching_seller s JOIN candidate c ON c.id=$2 AND c."emailVerified" LEFT JOIN coaching_connect_account k ON k.seller_id=s.id LEFT JOIN human_coach h ON h.id=s.coach_id WHERE s.id=$1 AND ((s.kind='human_coach' AND (k.owner_id=c.id OR (k.seller_id IS NULL AND h.email=lower(c.email) AND h.retired_at IS NULL))) OR (s.kind='association' AND EXISTS(SELECT 1 FROM coach_association_manager m WHERE m.association_id=s.association_id AND m.candidate_id=c.id)))`,
      [sellerId, personId],
    )
  ).rowCount;
}
export function coachEarnings(database: Pool, deps: { now?: () => Date } = {}) {
  const now = deps.now ?? (() => new Date());
  return {
    async statement(personId: string, sellerId: string, month: unknown = earningsMonth(now())): Promise<EarningsStatement | null> {
      const period = earningsPeriod(month);
      if (!period) return null;
      return inTransaction(database, async (within) => {
        await within.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        if (!(await mayReadEarnings(within, personId, sellerId))) return null;
        const seller = (await within.query<CoachingSeller>("SELECT id,kind,name,status,siret FROM coaching_seller WHERE id=$1", [sellerId])).rows[0]!;
        const stored = (
          await within.query<Stored>(
            `SELECT p.id,p.paid_at AS "paidAt",p.currency,e.amount,e.commission,e.refunded,e.refunded_commission AS "refundedCommission",e.processing_fees AS "processingFees",e.held,e.allocated,h.name AS "coachName",p.sale_snapshot AS sale,p.payee_snapshot AS payee,
    CASE WHEN p.service_archived THEN p.service_held_month WHEN s.scheduled_at IS NOT NULL AND s.scheduled_at+coalesce(s.duration_minutes,(p.sale_snapshot->>'durationMinutes')::integer)*interval '1 minute'<=$2 AND (s.withdrawn_at IS NULL OR s.withdrawn_at>=s.scheduled_at+coalesce(s.duration_minutes,(p.sale_snapshot->>'durationMinutes')::integer)*interval '1 minute') THEN to_char((s.scheduled_at+coalesce(s.duration_minutes,(p.sale_snapshot->>'durationMinutes')::integer)*interval '1 minute') AT TIME ZONE 'Europe/Paris','YYYY-MM') ELSE NULL END AS "heldMonth"
    FROM coaching_connect_payment p JOIN coaching_connect_earning e ON e.payment_id=p.id JOIN human_coach h ON h.id=p.coach_id LEFT JOIN coaching_session s ON s.stripe_checkout_session_id=p.checkout_id WHERE p.recipient_id=$1 AND p.paid_at IS NOT NULL ORDER BY p.paid_at,p.id`,
            [sellerId, now()],
          )
        ).rows;
        const selected = stored.filter((row) => inPeriod(row.paidAt, period)),
          held = stored.filter((row) => row.heldMonth === period.month),
          groups = new Map<string, EarningsOffer>();
        for (const row of [...selected, ...held]) {
          const key = keyOf(row);
          if (groups.has(key)) continue;
          groups.set(key, {
            key,
            coachName: row.coachName,
            offerId: row.sale.offerId,
            durationMinutes: row.sale.durationMinutes,
            seller: row.sale.seller,
            currency: row.currency,
            sessionsHeld: 0,
            payments: 0,
            collected: 0,
            commission: 0,
            refunded: 0,
            refundedCommission: 0,
            processingFees: 0,
            withheld: 0,
            net: 0,
          });
        }
        for (const row of selected) {
          const group = groups.get(keyOf(row))!,
            line = earningLine(row);
          group.payments++;
          group.collected += row.amount;
          group.commission += row.commission;
          group.refunded += row.refunded;
          group.refundedCommission += row.refundedCommission;
          group.processingFees += row.processingFees;
          group.withheld += row.held ?? 0;
          group.net += line.net;
        }
        for (const row of held) groups.get(keyOf(row))!.sessionsHeld++;
        const currencies = [...new Set(stored.map((row) => row.currency))].map((currency) => {
          const rows = selected.filter((row) => row.currency === currency),
            all = monthlyEarnings(
              stored.filter((row) => row.currency === currency),
              now(),
            ),
            sum = (read: (row: Stored) => number) => rows.reduce((total, row) => total + read(row), 0);
          const dates = all.lines
            .filter((line) => line.due > 0)
            .map((line) => line.payoutAt)
            .sort((a, b) => a.getTime() - b.getTime());
          return {
            currency,
            payments: rows.length,
            collected: sum((row) => row.amount),
            commission: sum((row) => row.commission),
            refunded: sum((row) => row.refunded),
            refundedCommission: sum((row) => row.refundedCommission),
            processingFees: sum((row) => row.processingFees),
            withheld: sum((row) => row.held ?? 0),
            net: sum((row) => earningLine(row).net),
            outstanding: all.due,
            nextPayoutAt: dates[0] ?? null,
          };
        });
        const payouts = (
          await within.query<EarningsPayout>(
            `SELECT b.id,b.month,b.currency,b.amount,b.state,b.created_at AS "createdAt",b.paid_at AS "paidAt" FROM coaching_connect_batch b WHERE b.seller_id=$1 AND (b.month=$2 OR (b.paid_at>=$3 AND b.paid_at<$4) OR EXISTS(SELECT 1 FROM coaching_connect_allocation a JOIN coaching_connect_payment p ON p.id=a.payment_id WHERE a.batch_id=b.id AND p.paid_at>=$3 AND p.paid_at<$4)) ORDER BY b.created_at,b.id`,
            [sellerId, period.month, period.start, period.end],
          )
        ).rows;
        const beneficiaries = [...new Map(selected.filter((row) => row.payee).map((row) => [JSON.stringify(row.payee), row.payee!])).values()];
        return { seller, beneficiaries, month: period.month, generatedAt: now(), sessionsHeld: held.length, currencies, offers: [...groups.values()], payouts };
      });
    },
  };
}
/** Preserve only the business fact of service completion before the purchaser's personal session is erased. */
export async function archiveEarningsService(database: Queryable, candidateId: string, at = new Date()) {
  await database.query(
    `UPDATE coaching_connect_payment p SET service_archived=true,service_held_month=CASE WHEN s.scheduled_at IS NOT NULL AND s.scheduled_at+coalesce(s.duration_minutes,(p.sale_snapshot->>'durationMinutes')::integer)*interval '1 minute'<=$2 AND (s.withdrawn_at IS NULL OR s.withdrawn_at>=s.scheduled_at+coalesce(s.duration_minutes,(p.sale_snapshot->>'durationMinutes')::integer)*interval '1 minute') THEN to_char((s.scheduled_at+coalesce(s.duration_minutes,(p.sale_snapshot->>'durationMinutes')::integer)*interval '1 minute') AT TIME ZONE 'Europe/Paris','YYYY-MM') ELSE NULL END FROM coaching_session s WHERE p.candidate_id=$1 AND NOT p.service_archived AND s.stripe_checkout_session_id=p.checkout_id`,
    [candidateId, at],
  );
}
export async function migrateCoachingEarnings(database: Pool) {
  await database.query(`ALTER TABLE coaching_connect_payment ADD COLUMN IF NOT EXISTS service_archived boolean NOT NULL DEFAULT false;
 ALTER TABLE coaching_connect_payment ADD COLUMN IF NOT EXISTS service_held_month text;
 ALTER TABLE coaching_connect_payment ADD COLUMN IF NOT EXISTS payee_snapshot jsonb;
 UPDATE coaching_connect_payment SET payee_snapshot=sale_snapshot->'seller' WHERE payee_snapshot IS NULL AND recipient_id::text=sale_snapshot#>>'{seller,id}';`);
}
