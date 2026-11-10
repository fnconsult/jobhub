/** The stable Stripe v1 Express adapter owns KYC, card processing and bank-account data. No KYC bytes enter Jobbbox. */
export interface ConnectAccount {
  id: string;
  active: boolean;
  canReceivePayouts?: boolean;
}
export interface ConnectCheckout {
  id: string;
  url: string | null;
  paid: boolean;
  amount: number;
  currency: string;
  paymentIntent: string | null;
  contextId: string | null;
}
export interface CheckoutRequest {
  contextId: string;
  accountId: string | null;
  amount: number;
  currency: string;
  commission: number;
  title: string;
  email: string;
  locale: "fr" | "en";
  successUrl: string;
  cancelUrl: string;
}
export interface PaymentBalance {
  amount: number;
  refunded: number;
  refundedCommission: number;
  processingFees: number;
  /** An unresolved dispute or uncaptured/unsettled payment must not enter a payout. */
  available: boolean;
}
export interface ConnectPort {
  account(seller: { id: string; kind: "human_coach" | "association"; name: string; email: string }, key: string): Promise<ConnectAccount>;
  status(accountId: string): Promise<ConnectAccount>;
  onboarding(accountId: string, returnUrl: string, refreshUrl: string): Promise<string>;
  dashboard(accountId: string): Promise<string>;
  checkout(request: CheckoutRequest, key: string): Promise<ConnectCheckout>;
  readCheckout(id: string, accountId: string | null): Promise<ConnectCheckout>;
  payment(id: string, accountId: string | null): Promise<PaymentBalance>;
  /** Recovered by durable batch metadata before retrying. Unknown outcomes must never create another payment. */
  transfer(input: { batchId: string; accountId: string; amount: number; currency: string; createdAt: Date }): Promise<string>;
  payout(input: {
    batchId: string;
    accountId: string;
    amount: number;
    currency: string;
    createdAt: Date;
  }): Promise<{ id: string; state: "pending" | "paid" | "failed" }>;
  payoutState(accountId: string, payoutId: string): Promise<"pending" | "paid" | "failed">;
}
