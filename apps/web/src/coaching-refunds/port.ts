/** Refunds always return money to the original payment in its frozen Stripe account. */
export interface RefundPayment {
  checkoutId: string;
  accountId: string | null;
  amount: number;
  currency: string;
  paymentIntent: string | null;
}
export interface RemoteCoachingRefund {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed";
  intentId: string | null;
  attempt: number | null;
}
export interface CoachingRefundPort {
  inspect(input: RefundPayment): Promise<{ paymentIntent: string; refunds: RemoteCoachingRefund[] }>;
  create(input: RefundPayment & { paymentIntent: string; intentId: string; attempt: number; refundAmount: number }): Promise<RemoteCoachingRefund>;
}
/** Only a conclusive rejection authorizes another numbered write. Network/5xx outcomes stay uncertain. */
export class CoachingRefundNotCreated extends Error {}

export class CoachingRefundContextMismatch extends Error {}
