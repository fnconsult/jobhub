import { withdrawalDeadline } from "../withdrawals/deadline";
/** Monetary values are integer cents. Refunds include confirmed and pending refunds: never pay money being returned. */
export interface Earning {
  id: string;
  paidAt: Date;
  amount: number;
  commission: number;
  refunded: number;
  refundedCommission: number;
  processingFees: number;
  /** Cumulative amount already allocated to successful/in-flight monthly payouts, including retained refund adjustments. */
  allocated: number;
  /** Unresolved dispute or unsettled balance, kept separate from actual refunds. */
  held?: number;
}
export interface EarningLine extends Earning {
  withdrawalClosesAt: Date;
  payoutAt: Date;
  net: number;
  due: number;
}
const cents = (value: number) => Number.isSafeInteger(value) && value >= 0;
export function commissionAmount(amount: number, basisPoints: number): number {
  if (!cents(amount) || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) throw new Error("Invalid commission");
  const result = Number((BigInt(amount) * BigInt(basisPoints) + 5000n) / 10000n);
  if (!Number.isSafeInteger(result)) throw new Error("Unsafe commission");
  return result;
}
/** First monthly payout boundary after the French withdrawal period has closed, including its weekend/holiday extension. */
export function scheduledPayoutAt(paidAt: Date): Date {
  const deadline = withdrawalDeadline(paidAt);
  const french = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).formatToParts(deadline);
  const year = Number(french.find((p) => p.type === "year")!.value),
    month = Number(french.find((p) => p.type === "month")!.value);
  // Noon UTC on the first is safely inside the French business day across both DST offsets.
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  return deadline <= first ? first : new Date(Date.UTC(year, month, 1, 12));
}
export function earningLine(entry: Earning): EarningLine {
  if (
    !Number.isFinite(entry.paidAt.getTime()) ||
    ![entry.amount, entry.commission, entry.refunded, entry.refundedCommission, entry.processingFees, entry.held ?? 0].every(cents) ||
    !Number.isSafeInteger(entry.allocated) ||
    entry.refunded > entry.amount ||
    entry.commission > entry.amount ||
    entry.refundedCommission > entry.commission
  )
    throw new Error("Invalid earning");
  const net = entry.amount - entry.commission - entry.refunded + entry.refundedCommission - entry.processingFees - (entry.held ?? 0);
  if (!Number.isSafeInteger(net) || !Number.isSafeInteger(net - entry.allocated)) throw new Error("Unsafe earning");
  return { ...entry, withdrawalClosesAt: withdrawalDeadline(entry.paidAt), payoutAt: scheduledPayoutAt(entry.paidAt), net, due: net - entry.allocated };
}
/** Negative refund balances are carried forward; they are never sent as a negative Stripe payout. */
export function monthlyEarnings(entries: Earning[], at: Date) {
  const lines = entries.map(earningLine),
    eligible = lines.filter((line) => line.payoutAt <= at);
  const due = Number(eligible.reduce((sum, line) => sum + BigInt(line.due), 0n));
  if (!Number.isSafeInteger(due)) throw new Error("Unsafe payout");
  return { lines, eligible, due, payout: Math.max(0, due), carry: Math.min(0, due) };
}

/** A compensation refund is rounded once in integer cents, including large configured platform prices. */
export function proportionalAmount(amount: number, part: number, total: number) {
  if (!cents(amount) || !cents(part) || !cents(total) || total === 0 || part > total) throw new Error("Invalid monetary proportion");
  return Number((BigInt(amount) * BigInt(part) + BigInt(total) / 2n) / BigInt(total));
}
