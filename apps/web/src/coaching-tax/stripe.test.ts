import { createServer, type Server } from "node:http";
import { beforeEach, afterEach, it, expect } from "vitest";
import { stripeTaxFacts, stripeTaxTransfers } from "./stripe";
import { taxQuarters } from "./model";
let server: Server,
  origin: string,
  calls: { path: string; account: string | undefined }[],
  refundStatus = "succeeded",
  metadata = "context-tax";
const credit = Date.parse("2026-03-31T21:00Z") / 1000,
  refundAt = Date.parse("2026-04-01T12:00Z") / 1000;
beforeEach(async () => {
  calls = [];
  refundStatus = "succeeded";
  metadata = "context-tax";
  server = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    calls.push({ path: url.pathname, account: request.headers["stripe-account"] as string | undefined });
    const routes: Record<string, unknown> = {
      "/v1/payment_intents/pi_tax": {
        id: "pi_tax",
        object: "payment_intent",
        status: "succeeded",
        amount: 10000,
        currency: "eur",
        metadata: { jobhub_context: metadata },
        latest_charge: {
          id: "ch_tax",
          object: "charge",
          amount: 10000,
          currency: "eur",
          disputed: false,
          application_fee: "fee_tax",
          balance_transaction: {
            id: "txn_credit",
            object: "balance_transaction",
            created: credit,
            amount: 10000,
            currency: "eur",
            net: 7700,
            fee: 2300,
            fee_details: [
              { amount: 2000, type: "application_fee" },
              { amount: 300, type: "stripe_fee" },
            ],
          },
        },
      },
      "/v1/application_fees/fee_tax": { id: "fee_tax", object: "application_fee", amount: 2000, charge: "ch_tax", currency: "eur" },
      "/v1/refunds": {
        object: "list",
        has_more: false,
        data: [
          {
            id: "re_tax",
            object: "refund",
            status: refundStatus,
            amount: 5000,
            created: refundAt,
            balance_transaction: { id: "txn_refund", created: refundAt, amount: -5000, currency: "eur", net: -5000, fee_details: [] },
          },
        ],
      },
      "/v1/application_fees/fee_tax/refunds": {
        object: "list",
        has_more: false,
        data: [{ id: "fr_tax", object: "fee_refund", amount: 1000, created: refundAt }],
      },
      "/v1/transfers/tr_tax": {
        id: "tr_tax",
        object: "transfer",
        amount: 8000,
        currency: "eur",
        destination: "acct_frozen",
        created: credit,
        metadata: { jobhub_batch: "batch-tax" },
      },
      "/v1/transfers/tr_tax/reversals": {
        object: "list",
        has_more: false,
        data: [{ id: "trr_tax", object: "transfer_reversal", amount: 2000, created: refundAt }],
      },
    };
    const body = routes[url.pathname];
    response.writeHead(body ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(body ?? { error: { message: "Unknown fake fiscal resource" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});
it("reads frozen-account resources with the real SDK and attributes refunds to the original income period", async () => {
  const facts = await stripeTaxFacts({ secretKey: "sk_test_fake", apiUrl: origin })({
    id: "context-tax",
    accountId: "acct_frozen",
    paymentIntent: "pi_tax",
    amount: 10000,
    commission: 2000,
    currency: "eur",
    sellerId: "seller-tax",
  });
  expect(taxQuarters(2026, facts, [])[0]).toMatchObject({ consideration: 3700, fees: 1300, activities: 1 });
  expect(facts.find((event) => event.id.endsWith("txn_refund"))).toMatchObject({ at: new Date(credit * 1000), observedAt: new Date(refundAt * 1000) });
  expect(calls.filter((call) => call.path.startsWith("/v1/application_fees")).every((call) => !call.account)).toBe(true);
  expect(calls.filter((call) => !call.path.startsWith("/v1/application_fees")).every((call) => call.account === "acct_frozen")).toBe(true);
});
it("rejects unresolved refunds and mismatched signed-payment context", async () => {
  const facts = stripeTaxFacts({ secretKey: "sk_test_fake", apiUrl: origin }),
    input = { id: "context-tax", accountId: "acct_frozen", paymentIntent: "pi_tax", amount: 10000, commission: 2000, currency: "eur", sellerId: "seller-tax" };
  refundStatus = "pending";
  await expect(facts(input)).rejects.toThrow("unresolved");
  refundStatus = "succeeded";
  metadata = "different-context";
  await expect(facts(input)).rejects.toThrow("mismatch");
});
it("reports only actual Coach compensation transfers, with linked reversals", async () => {
  const facts = await stripeTaxTransfers({ secretKey: "sk_test_fake", apiUrl: origin })({
    id: "tr_tax",
    batchId: "batch-tax",
    sellerId: "seller-tax",
    amount: 8000,
    currency: "eur",
    accountId: "acct_frozen",
    activities: 2,
  });
  expect(taxQuarters(2026, facts, [])[0]).toMatchObject({ consideration: 6000, fees: 0, activities: 2 });
  expect(calls.every((call) => !call.account)).toBe(true);
});
