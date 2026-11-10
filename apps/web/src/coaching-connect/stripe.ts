import { recordingClient, type ExternalApiLog } from "@jobhub/shared";
import Stripe from "stripe";
import type { ConnectAccount, ConnectCheckout, ConnectPort } from "./port";
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
  return {
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
      return checkout(await stripe.checkout.sessions.retrieve(id, {}, options(accountId)));
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
      const processingFees =
        balance && typeof balance !== "string"
          ? balance.fee_details.filter((item) => item.type !== "application_fee").reduce((sum, item) => sum + item.amount, 0)
          : 0;
      return {
        amount: payment.amount,
        refunded,
        refundedCommission,
        processingFees,
        available: payment.status === "succeeded" && !charge.disputed && !!balance && typeof balance !== "string" && balance.status === "available",
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
      for await (const found of stripe.payouts.list(
        { limit: 100, created: { gte: Math.floor(input.createdAt.getTime() / 1000) - 5 } },
        options(input.accountId),
      )) {
        if (found.metadata?.jobhub_batch !== input.batchId) continue;
        if (found.amount !== input.amount || found.currency !== input.currency) throw new Error("Payout recovery mismatch");
        return { id: found.id, state: state(found) };
      }
      recent(input.createdAt);
      const payout = await stripe.payouts.create(
        { amount: input.amount, currency: input.currency, metadata: { jobhub_batch: input.batchId } },
        { ...options(input.accountId), idempotencyKey: `coach-payout:${input.batchId}` },
      );
      return { id: payout.id, state: state(payout) };
    },
    async payoutState(accountId, id) {
      return state(await stripe.payouts.retrieve(id, {}, options(accountId)));
    },
  };
}
