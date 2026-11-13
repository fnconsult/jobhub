/** Test-only HTTP contracts exercised by the real Stripe SDK. Imported only by billing's fake server. */
import type { IncomingMessage } from "node:http";
type Json = Record<string, unknown>;
export function fakeConnectStripe() {
  const disputes = new Map<string, { account: string | null; value: Json }>();
  const accounts = new Map<string, Json>(),
    sessions = new Map<string, { account: string | null; value: Json }>(),
    payments = new Map<string, { account: string | null; value: Json }>(),
    fees = new Map<string, Json>(),
    transfers = new Map<string, Json>(),
    payouts = new Map<string, { account: string | null; value: Json }>(),
    refunds = new Map<string, { account: string | null; value: Json }>(),
    idempotent = new Map<string, Json>();
  let sequence = 0;
  const list = (data: Json[]) => ({ object: "list", has_more: false, data });
  const accountOf = (request: IncomingMessage) => (typeof request.headers["stripe-account"] === "string" ? request.headers["stripe-account"] : null);
  const metadata = (params: URLSearchParams, prefix = "metadata") =>
    Object.fromEntries(
      [...params].flatMap(([key, value]) => {
        const matched = new RegExp(`^${prefix}\\[(.+)\\]$`).exec(key);
        return matched ? [[matched[1]!, value]] : [];
      }),
    );
  return function route(request: IncomingMessage, params: URLSearchParams, reply: (status: number, json: Json) => void): boolean {
    const url = new URL(request.url ?? "/", "http://stripe.test"),
      path = url.pathname,
      method = request.method ?? "GET",
      account = accountOf(request),
      key = String(request.headers["idempotency-key"] ?? "");
    const respond = (value: Json, status = 200) => {
      if (key) idempotent.set(`${account}:${path}:${key}`, value);
      reply(status, value);
      return true;
    };
    const failure = () => {
      reply(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such Connect object in this account" } });
      return true;
    };
    const previous = key ? idempotent.get(`${account}:${path}:${key}`) : undefined;
    if (previous) return respond(previous);
    if (method === "GET" && path === "/__connect/state")
      return respond({
        accounts: [...accounts.values()],
        sessions: [...sessions.values()],
        transfers: [...transfers.values()],
        payouts: [...payouts.values()],
      });
    if (method === "POST" && path === "/__connect/activate") {
      const found = accounts.get(params.get("account") ?? "");
      if (!found) return failure();
      found.charges_enabled = true;
      found.payouts_enabled = true;
      found.details_submitted = true;
      found.capabilities = { card_payments: "active", transfers: "active" };
      return respond(found);
    }
    if (method === "POST" && path === "/__connect/pay") {
      const found = sessions.get(params.get("session") ?? "");
      if (!found) return failure();
      found.value.payment_status = "paid";
      return respond(found.value);
    }
    if (method === "POST" && path === "/__connect/balance") {
      const payment = payments.get(params.get("payment_intent") ?? "");
      if (!payment) return failure();
      const charge = payment.value.latest_charge as Json,
        balance = charge.balance_transaction as Json;
      balance.status = params.get("status") ?? "pending";
      if (params.has("intent_status")) payment.value.status = params.get("intent_status");
      return respond(payment.value);
    }
    if (method === "POST" && path === "/__connect/dispute") {
      const payment = payments.get(params.get("payment_intent") ?? "");
      if (!payment) return failure();
      const charge = payment.value.latest_charge as Json;
      charge.disputed = true;
      const status = params.get("status") ?? "needs_response",
        amount = Number(payment.value.amount),
        id = `dp_${charge.id}`;
      const movements =
        status === "warning_closed"
          ? []
          : [
              { id: `txn_withdraw_${id}`, amount: -amount, status: "available" },
              ...(status === "won" ? [{ id: `txn_return_${id}`, amount, status: params.get("balance_status") ?? "available" }] : []),
            ];
      const value = { id, object: "dispute", charge: charge.id, amount, currency: "eur", status, balance_transactions: movements };
      disputes.set(id, { account: payment.account, value });
      return respond(value);
    }
    if (method === "GET" && path === "/v1/disputes")
      return respond(
        list([...disputes.values()].filter((d) => d.account === account && d.value.charge === url.searchParams.get("charge")).map((d) => d.value)),
      );
    if (method === "GET" && path === "/v1/accounts") return respond(list([...accounts.values()]));
    if (method === "POST" && path === "/v1/accounts") {
      const id = `acct_connect_${++sequence}`,
        value = {
          id,
          object: "account",
          country: params.get("country"),
          email: params.get("email"),
          metadata: metadata(params),
          controller: {
            fees: { payer: params.get("controller[fees][payer]") },
            losses: { payments: params.get("controller[losses][payments]") },
            requirement_collection: params.get("controller[requirement_collection]"),
            stripe_dashboard: { type: params.get("controller[stripe_dashboard][type]") },
          },
          settings: { payouts: { schedule: { interval: params.get("settings[payouts][schedule][interval]") } } },
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          capabilities: { card_payments: "pending", transfers: "pending" },
        };
      accounts.set(id, value);
      return respond(value);
    }
    const accountId = /^\/v1\/accounts\/([^/]+)$/.exec(path)?.[1];
    if (method === "GET" && accountId) {
      const value = accounts.get(accountId);
      return value ? respond(value) : failure();
    }
    if (method === "POST" && path === "/v1/account_links")
      return respond({ object: "account_link", url: `https://connect.stripe.test/${params.get("account")}`, expires_at: Math.floor(Date.now() / 1000) + 300 });
    if (method === "POST" && /^\/v1\/accounts\/[^/]+\/login_links$/.test(path))
      return respond({ object: "login_link", url: "https://connect.stripe.test/dashboard" });
    if (method === "POST" && path === "/v1/checkout/sessions" && params.get("metadata[purpose]") === "coaching_connect") {
      if (account && !accounts.get(account)?.charges_enabled) {
        reply(400, { error: { type: "invalid_request_error", message: "Account not active" } });
        return true;
      }
      const id = `cs_connect_${++sequence}`,
        intent = `pi_connect_${sequence}`,
        charge = `ch_connect_${sequence}`,
        fee = `fee_connect_${sequence}`,
        amount = Number(params.get("line_items[0][price_data][unit_amount]")),
        commission = Number(params.get("payment_intent_data[application_fee_amount]") ?? 0);
      const value = {
        id,
        object: "checkout.session",
        mode: "payment",
        payment_status: "unpaid",
        amount_total: amount,
        currency: params.get("line_items[0][price_data][currency]"),
        url: `https://checkout.stripe.test/${id}`,
        payment_intent: intent,
        metadata: metadata(params),
        customer: `cus_connect_${sequence}`,
      };
      sessions.set(id, { account, value });
      payments.set(intent, {
        account,
        value: {
          id: intent,
          object: "payment_intent",
          status: "succeeded",
          amount,
          latest_charge: {
            id: charge,
            object: "charge",
            amount,
            currency: value.currency,
            disputed: false,
            application_fee: account ? fee : null,
            balance_transaction: {
              id: `txn_${sequence}`,
              object: "balance_transaction",
              status: "available",
              fee: commission,
              fee_details: account ? [{ type: "application_fee", amount: commission }] : [],
            },
          },
        },
      });
      if (account) fees.set(fee, { id: fee, object: "application_fee", amount: commission, amount_refunded: 0 });
      return respond(value);
    }
    const sessionId = /^\/v1\/checkout\/sessions\/(cs_connect_[^/]+)$/.exec(path)?.[1];
    if (method === "GET" && sessionId) {
      const found = sessions.get(sessionId);
      return found?.account === account ? respond(found.value) : failure();
    }
    const paymentId = /^\/v1\/payment_intents\/(pi_connect_[^/]+)$/.exec(path)?.[1];
    if (method === "GET" && paymentId) {
      const found = payments.get(paymentId);
      return found?.account === account ? respond(found.value) : failure();
    }
    const feeId = /^\/v1\/application_fees\/(fee_connect_[^/]+)$/.exec(path)?.[1];
    if (method === "GET" && feeId) {
      const found = fees.get(feeId);
      return found && account === null ? respond(found) : failure();
    }
    if (method === "POST" && path === "/v1/refunds" && params.get("payment_intent")?.startsWith("pi_connect_")) {
      const intent = params.get("payment_intent")!,
        payment = payments.get(intent);
      if (!payment || payment.account !== account) return failure();
      const charge = payment.value.latest_charge as Json,
        amount = Number(params.get("amount") ?? payment.value.amount),
        id = `re_connect_${++sequence}`;
      const value = {
        id,
        object: "refund",
        amount,
        currency: "eur",
        payment_intent: intent,
        charge: charge.id,
        status: "succeeded",
        metadata: metadata(params),
      };
      refunds.set(id, { account, value });
      const fee = typeof charge.application_fee === "string" ? fees.get(charge.application_fee) : undefined;
      if (fee && params.get("refund_application_fee") === "true")
        fee.amount_refunded = Math.min(
          Number(fee.amount),
          Number(fee.amount_refunded) + Math.round((Number(fee.amount) * amount) / Number(payment.value.amount)),
        );
      return respond(value);
    }
    if(method==='GET'&&path==='/v1/refunds'&&url.searchParams.get('payment_intent')?.startsWith('pi_connect_'))return respond(list([...refunds.values()].filter(r=>r.account===account&&r.value.payment_intent===url.searchParams.get('payment_intent')).map(r=>r.value)));
    if (method === "GET" && path === "/v1/refunds" && url.searchParams.get("charge")?.startsWith("ch_connect_"))
      return respond(list([...refunds.values()].filter((r) => r.account === account && r.value.charge === url.searchParams.get("charge")).map((r) => r.value)));
    if (method === "GET" && path === "/v1/transfers")
      return respond(
        list([...transfers.values()].filter((t) => !url.searchParams.get("destination") || t.destination === url.searchParams.get("destination"))),
      );
    if (method === "POST" && path === "/v1/transfers") {
      const id = `tr_connect_${++sequence}`,
        value = {
          id,
          object: "transfer",
          amount: Number(params.get("amount")),
          currency: params.get("currency"),
          destination: params.get("destination"),
          amount_reversed: 0,
          metadata: metadata(params),
          reversals: [],
        };
      transfers.set(id, value);
      return respond(value);
    }
    const transferId = /^\/v1\/transfers\/([^/]+)\/reversals$/.exec(path)?.[1];
    if (transferId) {
      const transfer = transfers.get(transferId);
      if (!transfer) return failure();
      const reversals = transfer.reversals as Json[];
      if (method === "GET") return respond(list(reversals));
      if (method === "POST") {
        const value = { id: `trr_connect_${++sequence}`, object: "transfer_reversal", amount: Number(params.get("amount")), metadata: metadata(params) };
        reversals.push(value);
        transfer.amount_reversed = Number(transfer.amount_reversed) + Number(value.amount);
        return respond(value);
      }
    }
    if (method === "GET" && path === "/v1/payouts") return respond(list([...payouts.values()].filter((p) => p.account === account).map((p) => p.value)));
    if (method === "POST" && path === "/v1/payouts") {
      const id = `po_connect_${++sequence}`,
        value = { id, object: "payout", amount: Number(params.get("amount")), currency: params.get("currency"), status: "paid", metadata: metadata(params) };
      payouts.set(id, { account, value });
      return respond(value);
    }
    const payoutId = /^\/v1\/payouts\/(po_connect_[^/]+)$/.exec(path)?.[1];
    if (method === "GET" && payoutId) {
      const found = payouts.get(payoutId);
      return found?.account === account ? respond(found.value) : failure();
    }
    return false;
  };
}
