import Stripe from "stripe";
import { recordingClient, type ExternalApiLog } from "@jobhub/shared";
import { CoachingRefundNotCreated, CoachingRefundContextMismatch, type CoachingRefundPort, type RemoteCoachingRefund } from "./port";
const normalized = (refund: Stripe.Refund): RemoteCoachingRefund => ({
  id: refund.id,
  amount: refund.amount,
  currency: refund.currency,
  status: refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending",
  intentId: refund.metadata?.jobhub_coaching_refund ?? null,
  attempt: refund.metadata?.jobhub_refund_attempt ? Number(refund.metadata.jobhub_refund_attempt) : null,
});
export function coachingRefundStripe(config: { secretKey: string; apiUrl?: string | undefined; externalApis?: ExternalApiLog }): CoachingRefundPort {
  const endpoint = config.apiUrl ? new URL(config.apiUrl) : null;
  const raw = new Stripe(config.secretKey, {
    timeout: 10000,
    maxNetworkRetries: 1,
    ...(endpoint ? { host: endpoint.hostname, port: endpoint.port, protocol: endpoint.protocol === "http:" ? ("http" as const) : ("https" as const) } : {}),
  });
  const stripe = config.externalApis ? recordingClient(raw, config.externalApis, { provider: "stripe" }) : raw;
  const options = (account: string | null) => (account ? { stripeAccount: account } : {});
  return {
    async inspect(input) {
      const session = await stripe.checkout.sessions.retrieve(input.checkoutId, {}, options(input.accountId));
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (
        session.id !== input.checkoutId ||
        session.payment_status !== "paid" ||
        !pi ||
        session.amount_total !== input.amount ||
        session.currency !== input.currency ||
        (input.paymentIntent && input.paymentIntent !== pi)
      )
        throw new CoachingRefundContextMismatch("Refund payment context mismatch");
      const refunds: RemoteCoachingRefund[] = [];
      for await (const refund of stripe.refunds.list({ payment_intent: pi, limit: 100 }, options(input.accountId))) {
        if (refund.currency !== input.currency) throw new CoachingRefundContextMismatch("Refund currency mismatch");
        refunds.push(normalized(refund));
      }
      return { paymentIntent: pi, refunds };
    },
    async create(input) {
      try {
        const refund = await stripe.refunds.create(
          {
            payment_intent: input.paymentIntent,
            amount: input.refundAmount,
            reason: "requested_by_customer",
            metadata: { jobhub_coaching_refund: input.intentId, jobhub_refund_attempt: String(input.attempt) },
            ...(input.accountId ? { refund_application_fee: true } : {}),
          },
          { ...options(input.accountId), idempotencyKey: `coach-refund-${input.intentId}-${input.attempt}` },
        );
        return normalized(refund);
      } catch (error) {
        if (error instanceof Stripe.errors.StripeError && error.statusCode !== undefined && error.statusCode < 500 && error.type !== "StripeConnectionError")
          throw new CoachingRefundNotCreated(error.code ?? "stripe_refused");
        throw error;
      }
    },
  };
}
