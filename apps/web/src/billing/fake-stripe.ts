/**
 * A stand-in for the Stripe API over HTTP, for tests and the e2e suite. The
 * billing module talks to it through the real Stripe SDK (STRIPE_API_URL), so
 * everything up to the network is exercised. It answers the few calls the
 * billing module makes and records them (GET /__calls lists them, for tests
 * in another process); `signedEvent` builds webhook deliveries signed the way
 * Stripe signs them.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";

export interface StripeCall {
  method: string;
  path: string;
  params: URLSearchParams;
}

export const FAKE_STRIPE_SECRET_KEY = "sk_test_fake";
export const FAKE_STRIPE_WEBHOOK_SECRET = "whsec_test_fake";
export const FAKE_STRIPE_PRICES = { standard: "price_standard_monthly", premium: "price_premium_monthly" } as const;
/** One-off Prices of a Coaching Session: 90 € (regular) and 72 € (Premium Plan). */
export const FAKE_STRIPE_COACHING_SESSION_PRICES = { regular: "price_coaching_session", premium: "price_coaching_session_premium" } as const;
const FAKE_UNIT_AMOUNTS: Record<string, number> = {
  [FAKE_STRIPE_COACHING_SESSION_PRICES.regular]: 9000,
  [FAKE_STRIPE_COACHING_SESSION_PRICES.premium]: 7200,
  [FAKE_STRIPE_PRICES.standard]: 1900,
  [FAKE_STRIPE_PRICES.premium]: 3900,
};

/** The Stripe customer id the fake gives the person with this email, so tests can address webhooks to them. */
export function fakeCustomerId(email: string): string {
  return `cus_fake_${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;
}

/** Starts the fake on `port` (any free port by default). */
export async function startFakeStripe(port = 0) {
  const calls: StripeCall[] = [];
  const forgotten = new Set<string>();
  let sequence = 0;
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const path = new URL(request.url ?? "/", "http://stripe.test").pathname;
      const params = new URLSearchParams(body);
      calls.push({ method: request.method ?? "GET", path, params });
      const id = ++sequence;
      const reply = (status: number, json: unknown) => {
        response.writeHead(status, { "content-type": "application/json", "request-id": `req_${id}` });
        response.end(JSON.stringify(json));
      };
      if (request.method === "POST" && path === "/v1/customers") {
        return reply(200, { id: fakeCustomerId(params.get("email") ?? ""), object: "customer", email: params.get("email") });
      }
      const customerPath = path.match(/^\/v1\/customers\/([^/]+)$/);
      if (request.method === "DELETE" && customerPath) {
        const customer = decodeURIComponent(customerPath[1]!);
        if (forgotten.has(customer)) {
          return reply(404, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such customer: '${customer}'` } });
        }
        forgotten.add(customer);
        return reply(200, { id: customer, object: "customer", deleted: true });
      }
      if (request.method === "POST" && path === "/v1/checkout/sessions") {
        return reply(200, { id: `cs_fake${id}`, object: "checkout.session", url: `https://checkout.stripe.test/cs_fake${id}` });
      }
      if (request.method === "POST" && path === "/v1/billing_portal/sessions") {
        return reply(200, { id: `bps_fake${id}`, object: "billing_portal.session", url: `https://billing.stripe.test/bps_fake${id}` });
      }
      const price = request.method === "GET" && path.match(/^\/v1\/prices\/([^/]+)$/)?.[1];
      if (price && FAKE_UNIT_AMOUNTS[price] !== undefined) {
        return reply(200, { id: price, object: "price", unit_amount: FAKE_UNIT_AMOUNTS[price], currency: "eur" });
      }
      if (request.method === "GET" && path === "/__calls") return reply(200, calls.map((call) => ({ ...call, params: Object.fromEntries(call.params) })));
      reply(404, { error: { type: "invalid_request_error", message: `fake Stripe has no ${request.method} ${path}` } });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    /** Makes the fake answer as if the customer had been deleted on Stripe's side. */
    forgetCustomer: (customer: string) => void forgotten.add(customer),
    /** Calls made to one endpoint, e.g. "/v1/checkout/sessions". */
    callsTo: (path: string) => calls.filter((call) => call.path === path),
    stop: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export type FakeStripe = Awaited<ReturnType<typeof startFakeStripe>>;

let eventSequence = 0;

/** A `customer.subscription.*` event as Stripe sends it, reduced to the fields that matter. */
export function subscriptionEvent(
  type: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted",
  subscription: { customer: string; price: string; status: string; id?: string },
  createdAt: Date = new Date(),
) {
  eventSequence += 1;
  return {
    id: `evt_fake${eventSequence}`,
    object: "event",
    type,
    created: Math.floor(createdAt.getTime() / 1000),
    data: {
      object: {
        id: subscription.id ?? `sub_fake_${subscription.customer}`,
        object: "subscription",
        customer: subscription.customer,
        status: subscription.status,
        items: { object: "list", data: [{ id: `si_fake${eventSequence}`, price: { id: subscription.price } }] },
      },
    },
  };
}

/** A `checkout.session.*` event as Stripe sends it, reduced to the fields that matter. A Coaching Session's unless `mode` says otherwise. */
export function checkoutSessionEvent(
  type: "checkout.session.completed" | "checkout.session.async_payment_succeeded",
  session: {
    id: string;
    candidateId: string;
    coachId?: string;
    amount: number;
    currency: string;
    paymentStatus: "paid" | "unpaid" | "no_payment_required";
    mode?: "payment" | "subscription";
  },
  createdAt: Date = new Date(),
) {
  eventSequence += 1;
  const mode = session.mode ?? "payment";
  return {
    id: `evt_fake${eventSequence}`,
    object: "event",
    type,
    created: Math.floor(createdAt.getTime() / 1000),
    data: {
      object: {
        id: session.id,
        object: "checkout.session",
        mode,
        client_reference_id: session.candidateId,
        payment_status: session.paymentStatus,
        amount_total: session.amount,
        currency: session.currency,
        metadata: mode === "payment" ? { purpose: "coaching_session", coach_id: session.coachId ?? "", candidate_id: session.candidateId } : {},
      },
    },
  };
}

/** The body and Stripe-Signature header of a webhook delivery. */
export function signedEvent(event: unknown, secret: string = FAKE_STRIPE_WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const signature = new Stripe(FAKE_STRIPE_SECRET_KEY).webhooks.generateTestHeaderString({ payload, secret });
  return { payload, signature };
}
