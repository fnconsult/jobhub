/**
 * What a Withdrawal refunds of a payment for a Plan (#512, C. conso. L221-25): the Candidate who asked for the service to
 * start at once pays for what was provided until they withdrew, in proportion to the price; one who did not owes nothing.
 * What was provided is counted in whole days elapsed since the start of the period the payment was for: the day begun is
 * not counted, in the Candidate's favour. A payment whose period Stripe did not tell is refunded in full.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The part of `payment` (in cents) a Withdrawal at `withdrawnAt` refunds. */
export function withdrawalRefund(payment: { amount: number; period?: { start: Date; end: Date } }, withdrawnAt: Date, immediateExecutionRequested: boolean): number {
  if (!immediateExecutionRequested || !payment.period) return payment.amount;
  const { start, end } = payment.period;
  // Rounded: a period over a change to or from summer time is an hour off whole days.
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (days <= 0) return payment.amount;
  const elapsed = Math.min(days, Math.max(0, Math.floor((withdrawnAt.getTime() - start.getTime()) / DAY_MS)));
  return payment.amount - Math.round((payment.amount * elapsed) / days);
}
