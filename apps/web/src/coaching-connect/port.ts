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
  /** Availability of the original payment/balance, independently of any dispute. */
  settled?: boolean;
  /** Actual dispute balance withdrawn and not yet reinstated as available funds. */
  held?: number;
}
export interface SettlementRequest {
  batchId: string;
  accountId: string;
  amount: number;
  currency: string;
  createdAt: Date;
  attempt?: number;
  attemptedAt?: Date;
}
export interface RecoveredPayout {
  id: string;
  state: "pending" | "paid" | "failed";
}
/** Only an authoritative rejection of the create request proves no remote money movement occurred. */
export class ConnectOperationNotCreated extends Error {}
export interface ConnectPort {
  account(seller: { id: string; kind: "human_coach" | "association"; name: string; email: string }, key: string): Promise<ConnectAccount>;
  status(accountId: string): Promise<ConnectAccount>;
  onboarding(accountId: string, returnUrl: string, refreshUrl: string): Promise<string>;
  dashboard(accountId: string): Promise<string>;
  checkout(request: CheckoutRequest, key: string): Promise<ConnectCheckout>;
  readCheckout(id: string, accountId: string | null): Promise<ConnectCheckout | null>;
  payment(id: string, accountId: string | null): Promise<PaymentBalance>;
  findPayout(input: SettlementRequest): Promise<RecoveredPayout | null>;
  findTransfer(input: SettlementRequest): Promise<{ id: string; amount: number; complete: boolean } | null>;
  /** Recovered by durable batch metadata before retrying. Unknown outcomes must never create another payment. */
  transfer(input: SettlementRequest): Promise<string>;
  payout(input: SettlementRequest): Promise<RecoveredPayout>;
  payoutState(accountId: string, payoutId: string): Promise<"pending" | "paid" | "failed">;
}
