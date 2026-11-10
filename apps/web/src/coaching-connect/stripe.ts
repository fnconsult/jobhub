import { recordingClient, type ExternalApiLog } from "@jobhub/shared";
import Stripe from "stripe";
import { ConnectOperationNotCreated, type SettlementRequest, type ConnectAccount, type ConnectCheckout, type ConnectPort } from "./port";
export interface ConnectStripeConfig {
  secretKey: string;
  webhookSecret: string;
  apiUrl?: string | undefined;
  now?: () => Date;
  externalApis?: ExternalApiLog;
}
const checkout = (session: Stripe.Checkout.Session): ConnectCheckout => ({
  id: session.id,
  url: session.url,
  paid: session.payment_status === "paid",
  amount: session.amount_total ?? 0,
  currency: session.currency ?? "",
  paymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
  contextId: session.metadata?.jobhub_context ?? null,
});
const controlled = (value: Stripe.Account) =>
  value.country === "FR" &&
  value.settings?.payouts?.schedule.interval === "manual" &&
  value.controller?.requirement_collection === "stripe" &&
  value.controller?.stripe_dashboard?.type === "express" &&
  ["application", "application_express"].includes(value.controller?.fees?.payer ?? "") &&
  value.controller?.losses?.payments === "application";
const account = (value: Stripe.Account): ConnectAccount => ({
  id: value.id,
  canReceivePayouts: value.payouts_enabled === true && controlled(value),
  active:
    controlled(value) &&
    value.charges_enabled === true &&
    value.payouts_enabled === true &&
    value.details_submitted === true &&
    value.capabilities?.card_payments === "active" &&
    value.capabilities?.transfers === "active" &&
    value.settings?.payouts?.schedule.interval === "manual" &&
    value.controller?.requirement_collection === "stripe" &&
    value.controller?.stripe_dashboard?.type === "express",
});
const state = (payout: Stripe.Payout) =>
  payout.status === "paid" ? ("paid" as const) : payout.status === "failed" || payout.status === "canceled" ? ("failed" as const) : ("pending" as const);
export function stripeConnect(
  config: ConnectStripeConfig,
): ConnectPort & { verify(body: string, signature: string): Stripe.Event; checkout: ConnectPort["checkout"]; decodeCheckout: typeof checkout } {
  const endpoint = config.apiUrl ? new URL(config.apiUrl) : null,
    now = config.now ?? (() => new Date());
  const raw = new Stripe(config.secretKey, {
    maxNetworkRetries: 2,
    ...(endpoint ? { host: endpoint.hostname, port: endpoint.port, protocol: endpoint.protocol === "http:" ? ("http" as const) : ("https" as const) } : {}),
  });
  const stripe = config.externalApis ? recordingClient(raw, config.externalApis, { provider: "stripe" }) : raw;
  const options = (id: string | null) => (id ? { stripeAccount: id } : {});
  function recent(createdAt: Date) {
    if (now().getTime() - createdAt.getTime() > 23 * 3600000) throw new Error("Unknown Stripe outcome requires reconciliation");
  }
  async function findPayout(input: SettlementRequest) {
    for await (const found of stripe.payouts.list(
      { limit: 100, created: { gte: Math.floor(input.createdAt.getTime() / 1000) - 5 } },
      options(input.accountId),
    )) {
      if (found.metadata?.jobhub_batch !== input.batchId) continue;
      if (found.amount !== input.amount || found.currency !== input.currency) throw new Error("Payout recovery mismatch");
      return { id: found.id, state: state(found) };
    }
    return null;
  }
  async function findTransfer(input: SettlementRequest) {
    let recovered = 0;
    for await (const found of stripe.transfers.list({ destination: input.accountId, limit: 100 })) {
      if (found.currency !== input.currency) continue;
      if (input.amount > 0 && found.metadata.jobhub_batch === input.batchId) {
        if (found.amount !== input.amount) throw new Error("Transfer recovery mismatch");
        return { id: found.id, amount: found.amount, complete: true };
      }
      if (input.amount < 0 && found.metadata.jobhub_account === input.accountId)
        for await (const reversal of stripe.transfers.listReversals(found.id, { limit: 100 }))
          if (reversal.metadata?.jobhub_adjustment === input.batchId) recovered += reversal.amount;
    }
    return recovered ? { id: `reversal:${input.batchId}`, amount: -recovered, complete: recovered === -input.amount } : null;
  }
  return {
    findPayout,
    findTransfer,
    verify: (body, signature) => stripe.webhooks.constructEvent(body, signature, config.webhookSecret),
    decodeCheckout: checkout,
    async account(seller, key) {
      const matches: Stripe.Account[] = [];
      for await (const found of stripe.accounts.list({ limit: 100 })) if (found.metadata?.jobhub_seller === seller.id) matches.push(found);
      if (matches.length > 1) throw new Error("Duplicate Connect identity requires reconciliation");
      if (matches[0]) return account(matches[0]);
      // Stable v1 Express-equivalent controller. The platform bears fees and negative-balance liability;
      // the fee-payer=account/losses=stripe preview combination is deliberately not assumed available in France.
      return account(
        await stripe.accounts.create(
          {
            country: "FR",
            email: seller.email,
            business_profile: { name: seller.name },
            ...(seller.kind === "association" ? { business_type: "non_profit" as const } : {}),
            controller: {
              fees: { payer: "application" },
              losses: { payments: "application" },
              requirement_collection: "stripe",
              stripe_dashboard: { type: "express" },
            },
            capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
            settings: { payouts: { schedule: { interval: "manual" } } },
            metadata: { jobhub_seller: seller.id },
          },
          { idempotencyKey: key },
        ),
      );
    },
    async status(id) {
      return account(await stripe.accounts.retrieve(id));
    },
    async onboarding(id, returnUrl, refreshUrl) {
      return (await stripe.accountLinks.create({ account: id, return_url: returnUrl, refresh_url: refreshUrl, type: "account_onboarding" })).url;
    },
    async dashboard(id) {
      return (await stripe.accounts.createLoginLink(id)).url;
    },
    async checkout(input, key) {
      return checkout(
        await stripe.checkout.sessions.create(
          {
            mode: "payment",
            customer_email: input.email,
            customer_creation: "always",
            line_items: [{ price_data: { currency: input.currency, unit_amount: input.amount, product_data: { name: input.title } }, quantity: 1 }],
            metadata: { purpose: "coaching_connect", jobhub_context: input.contextId },
            payment_intent_data: { metadata: { jobhub_context: input.contextId }, ...(input.accountId ? { application_fee_amount: input.commission } : {}) },
            locale: input.locale,
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
          },
          { ...options(input.accountId), idempotencyKey: key },
        ),
      );
    },
    async readCheckout(id, accountId) {
      try {
        return checkout(await stripe.checkout.sessions.retrieve(id, {}, options(accountId)));
      } catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) return null;
        throw error;
      }
    },
    async payment(id, accountId) {
      const payment = await stripe.paymentIntents.retrieve(id, { expand: ["latest_charge.balance_transaction"] }, options(accountId));
      const charge = payment.latest_charge;
      if (!charge || typeof charge === "string") throw new Error("Missing settled charge");
      const balance = charge.balance_transaction;
      let refunded = 0;
      for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 }, options(accountId)))
        if (!["failed", "canceled"].includes(refund.status ?? "")) refunded += refund.amount;
      // Application fees are platform-owned: query their refunds in the platform context.
      const fee = charge.application_fee;
      const applicationFee = typeof fee === "string" ? await stripe.applicationFees.retrieve(fee) : fee;
      const refundedCommission = applicationFee?.amount_refunded ?? 0;
      let processingFees =
        balance && typeof balance !== "string"
          ? balance.fee_details.filter((item) => item.type !== "application_fee").reduce((sum, item) => sum + item.amount, 0)
          : 0;
      let disputeCleared = !charge.disputed,
        disputeHeld = 0;
      if (charge.disputed) {
        const disputes = [] as Stripe.Dispute[];
        for await (const dispute of stripe.disputes.list({ charge: charge.id, limit: 100 }, options(accountId))) disputes.push(dispute);
        const availableMovements = disputes
          .flatMap((dispute) => dispute.balance_transactions ?? [])
          .filter((transaction) => transaction.status === "available");
        disputeHeld = Math.max(0, -availableMovements.reduce((sum, transaction) => sum + (transaction.net ?? transaction.amount), 0));
        // Charge.disputed is historical. Only a won or closed warning releases its held balance.
        disputeCleared =
          disputes.length > 0 &&
          disputes.every((dispute) => {
            if (dispute.status !== "won" && dispute.status !== "warning_closed") return false;
            const movements = dispute.balance_transactions ?? [];
            const credited = movements.filter((transaction) => transaction.amount > 0);
            return (
              (dispute.status === "warning_closed" || credited.length > 0) &&
              credited.every((transaction) => transaction.status === "available") &&
              movements.reduce((sum, transaction) => sum + transaction.amount, 0) >= 0
            );
          });
      }
      if (disputeCleared) processingFees += disputeHeld; // Any actually debited, unreturned dispute fee remains an expense.
      return {
        amount: payment.amount,
        refunded,
        refundedCommission,
        processingFees,
        held: disputeCleared ? 0 : disputeHeld || payment.amount,
        available: payment.status === "succeeded" && disputeCleared && !!balance && typeof balance !== "string" && balance.status === "available",
      };
    },
    async transfer(input) {
      if (input.amount > 0) {
        for await (const found of stripe.transfers.list({
          destination: input.accountId,
          limit: 100,
          created: { gte: Math.floor(input.createdAt.getTime() / 1000) - 5 },
        })) {
          if (found.metadata.jobhub_batch !== input.batchId) continue;
          if (found.amount !== input.amount || found.currency !== input.currency) throw new Error("Transfer recovery mismatch");
          return found.id;
        }
        recent(input.createdAt);
        try {
          return (
            await stripe.transfers.create(
              {
                amount: input.amount,
                currency: input.currency,
                destination: input.accountId,
                metadata: { jobhub_batch: input.batchId, jobhub_account: input.accountId },
              },
              { idempotencyKey: `coach-transfer:${input.batchId}` },
            )
          ).id;
        } catch (error) {
          if (
            (error instanceof Stripe.errors.StripeInvalidRequestError ||
              error instanceof Stripe.errors.StripePermissionError ||
              error instanceof Stripe.errors.StripeAuthenticationError) &&
            error.statusCode &&
            error.statusCode < 500
          )
            throw new ConnectOperationNotCreated("Stripe rejected transfer creation");
          throw error;
        }
      }
      if (!input.amount) throw new Error("Empty transfer adjustment");
      // Return compensation paid by Jobbbox when a later refund exceeds new Jobbbox earnings.
      // Netting it against third-party earnings alone would strand Jobbbox's recovered money on the connected account.
      const transfers: Stripe.Transfer[] = [];
      let recovered = 0;
      for await (const found of stripe.transfers.list({ destination: input.accountId, limit: 100 })) {
        if (found.metadata.jobhub_account !== input.accountId || found.currency !== input.currency) continue;
        transfers.push(found);
        for await (const reversal of stripe.transfers.listReversals(found.id, { limit: 100 }))
          if (reversal.metadata?.jobhub_adjustment === input.batchId) recovered += reversal.amount;
      }
      let remaining = -input.amount - recovered;
      if (remaining < 0) throw new Error("Transfer reversal recovery mismatch");
      for (const found of transfers) {
        if (!remaining) break;
        const previous = [] as Stripe.TransferReversal[];
        for await (const reversal of stripe.transfers.listReversals(found.id, { limit: 100 })) previous.push(reversal);
        if (previous.some((r) => r.metadata?.jobhub_adjustment === input.batchId)) continue;
        const available = found.amount - previous.reduce((sum, r) => sum + r.amount, 0),
          amount = Math.min(remaining, available);
        if (!amount) continue;
        recent(input.createdAt);
        await stripe.transfers.createReversal(
          found.id,
          { amount, metadata: { jobhub_adjustment: input.batchId } },
          { idempotencyKey: `coach-reversal:${input.batchId}:${found.id}` },
        );
        remaining -= amount;
      }
      if (remaining) throw new Error("Insufficient prior Jobbbox transfers for reversal");
      return `reversal:${input.batchId}`;
    },
    async payout(input) {
      const recovered = await findPayout(input);
      if (recovered) return recovered;
      recent(input.attemptedAt ?? input.createdAt);
      try {
        const payout = await stripe.payouts.create(
          { amount: input.amount, currency: input.currency, metadata: { jobhub_batch: input.batchId } },
          { ...options(input.accountId), idempotencyKey: `coach-payout:${input.batchId}:${input.attempt ?? 0}` },
        );
        return { id: payout.id, state: state(payout) };
      } catch (error) {
        if (
          (error instanceof Stripe.errors.StripeInvalidRequestError ||
            error instanceof Stripe.errors.StripePermissionError ||
            error instanceof Stripe.errors.StripeAuthenticationError) &&
          error.statusCode &&
          error.statusCode < 500
        )
          throw new ConnectOperationNotCreated("Stripe rejected payout creation");
        throw error;
      }
    },
    async payoutState(accountId, id) {
      return state(await stripe.payouts.retrieve(id, {}, options(accountId)));
    },
  };
}
