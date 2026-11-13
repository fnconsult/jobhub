import Stripe from "stripe";
import { recordingClient, type ExternalApiLog } from "@jobhub/shared";
import type { TaxPayment } from "./index";
import type { TaxEvent } from "./model";
/** Read-only fiscal resources from the frozen direct-charge account, not from the Seller's current routing. */
export function stripeTaxFacts(config: { secretKey: string; apiUrl?: string; externalApis?: ExternalApiLog }) {
  const endpoint = config.apiUrl ? new URL(config.apiUrl) : null;
  const raw = new Stripe(config.secretKey, {
    maxNetworkRetries: 2,
    ...(endpoint ? { host: endpoint.hostname, port: endpoint.port, protocol: endpoint.protocol === "http:" ? ("http" as const) : ("https" as const) } : {}),
  });
  const stripe = config.externalApis ? recordingClient(raw, config.externalApis, { provider: "stripe" }) : raw;
  return async (input: TaxPayment): Promise<TaxEvent[]> => {
    const options = { stripeAccount: input.accountId };
    const payment = await stripe.paymentIntents.retrieve(input.paymentIntent, { expand: ["latest_charge.balance_transaction"] }, options);
    const charge = payment.latest_charge;
    if (
      payment.status !== "succeeded" ||
      payment.amount !== input.amount ||
      (charge && typeof charge !== "string" && charge.amount !== input.amount) ||
      payment.currency !== input.currency ||
      payment.metadata.jobhub_context !== input.id ||
      !charge ||
      typeof charge === "string" ||
      charge.currency !== input.currency
    )
      throw Error("Fiscal payment context mismatch");
    const balance = charge.balance_transaction;
    if (!balance || typeof balance === "string") throw Error("Fiscal charge balance unavailable");
    const fees = input.commission + balance.fee_details.filter((item) => item.type !== "application_fee").reduce((sum, item) => sum + item.amount, 0);
    const applicationFee = typeof charge.application_fee === "string" ? await stripe.applicationFees.retrieve(charge.application_fee) : charge.application_fee;
    if (
      (applicationFee?.amount ?? 0) !== input.commission ||
      (applicationFee && typeof applicationFee.charge === "string" && applicationFee.charge !== charge.id)
    )
      throw Error("Fiscal commission mismatch");
    const events: TaxEvent[] = [
      {
        id: `${input.accountId}:${balance.id}`,
        at: new Date(balance.created * 1000),
        consideration: input.amount - fees,
        fees,
        activities: 1,
        currency: input.currency,
      },
    ];
    for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 }, options)) {
      if (refund.status === "pending" || refund.status === "requires_action") throw Error("Fiscal refund unresolved");
      if (refund.status !== "succeeded") continue;
      const refundBalance =
        typeof refund.balance_transaction === "string"
          ? await stripe.balanceTransactions.retrieve(refund.balance_transaction, {}, options)
          : refund.balance_transaction;
      if (!refundBalance || refundBalance.currency !== input.currency) throw Error("Fiscal refund balance unavailable");
      const refundedFees = refundBalance.fee_details.filter((item) => item.type !== "application_fee").reduce((sum, item) => sum + item.amount, 0);
      events.push({
        id: `${input.accountId}:${refundBalance.id}`,
        at: new Date(balance.created * 1000),
        observedAt: new Date(refundBalance.created * 1000),
        consideration: -refund.amount - refundedFees,
        fees: refundedFees,
        activities: 0,
        currency: input.currency,
      });
    }
    if (applicationFee)
      for await (const refund of stripe.applicationFees.listRefunds(applicationFee.id, { limit: 100 }))
        events.push({
          id: `application-fee:${refund.id}`,
          at: new Date(balance.created * 1000),
          observedAt: new Date(refund.created * 1000),
          consideration: refund.amount,
          fees: -refund.amount,
          activities: 0,
          currency: input.currency,
        });
    if (charge.disputed)
      for await (const dispute of stripe.disputes.list({ charge: charge.id, limit: 100 }, options)) {
        if (!["won", "lost", "warning_closed"].includes(dispute.status)) throw Error("Fiscal dispute unresolved");
        for (const movement of dispute.balance_transactions ?? [])
          events.push({
            id: `${input.accountId}:${movement.id}`,
            at: new Date(balance.created * 1000),
            observedAt: new Date(movement.created * 1000),
            consideration: movement.net,
            fees: movement.fee,
            activities: 0,
            currency: movement.currency,
          });
      }
    return events;
  };
}
/** Jobbbox's retail turnover is not a Coach receipt; only the actual frozen compensation transfer is included. */
export function stripeTaxTransfers(config: { secretKey: string; apiUrl?: string; externalApis?: ExternalApiLog }) {
  const endpoint = config.apiUrl ? new URL(config.apiUrl) : null;
  const raw = new Stripe(config.secretKey, {
    maxNetworkRetries: 2,
    ...(endpoint ? { host: endpoint.hostname, port: endpoint.port, protocol: endpoint.protocol === "http:" ? ("http" as const) : ("https" as const) } : {}),
  });
  const stripe = config.externalApis ? recordingClient(raw, config.externalApis, { provider: "stripe" }) : raw;
  return async (input: import("./index").TaxTransfer): Promise<TaxEvent[]> => {
    const transfer = await stripe.transfers.retrieve(input.id),
      destination = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id;
    if (
      destination !== input.accountId ||
      transfer.amount !== input.amount ||
      transfer.currency !== input.currency ||
      transfer.metadata.jobhub_batch !== input.batchId
    )
      throw Error("Fiscal transfer context mismatch");
    const at = new Date(transfer.created * 1000),
      events: TaxEvent[] = [
        { id: `transfer:${transfer.id}`, at, consideration: transfer.amount, fees: 0, activities: input.activities, currency: transfer.currency },
      ];
    for await (const reversal of stripe.transfers.listReversals(transfer.id, { limit: 100 }))
      events.push({
        id: `reversal:${reversal.id}`,
        at,
        observedAt: new Date(reversal.created * 1000),
        consideration: -reversal.amount,
        fees: 0,
        activities: 0,
        currency: transfer.currency,
      });
    return events;
  };
}
