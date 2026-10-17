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
/** The Prices Standard (19 €/month) and Premium (39 €/month) are sold at: their products' default Prices, and STRIPE_PRICE_STANDARD / _PREMIUM. */
export const FAKE_STRIPE_PRICES = {
  standard: "price_standard_monthly",
  premium: "price_premium_monthly",
  essential: "price_essential_monthly",
  /** Two Plans' prices on one product, a set-up the Back Office does not allow (one product per Plan). */
  bundleStandard: "price_bundle_standard",
  bundlePremium: "price_bundle_premium",
} as const;
/**
 * The Stripe products the fake knows: Standard's and Premium's, and others for Plans an
 * Administrator creates: Essentiel (29 €/month, a fit), and ones a Plan cannot be tied to
 * (archived, a one-off default Price, no default Price, charged every 3 months).
 */
export const FAKE_STRIPE_PRODUCTS = {
  standard: "prod_standard",
  premium: "prod_premium",
  essential: "prod_essential",
  archived: "prod_archived",
  oneOff: "prod_one_off",
  noPrice: "prod_no_price",
  quarterly: "prod_quarterly",
} as const;
/** One-off Prices of a Coaching Session: 90 € (regular) and 72 € (with the Coaching Session discount). */
export const FAKE_STRIPE_COACHING_SESSION_PRICES = { regular: "price_coaching_session", discounted: "price_coaching_session_premium" } as const;

type FakePrice = { amount: number; product: string; recurring: { interval: string; interval_count: number } | null };
const MONTHLY = { interval: "month", interval_count: 1 };
const FAKE_PRICES: Record<string, FakePrice> = {
  [FAKE_STRIPE_COACHING_SESSION_PRICES.regular]: { amount: 9000, product: "prod_coaching_session", recurring: null },
  [FAKE_STRIPE_COACHING_SESSION_PRICES.discounted]: { amount: 7200, product: "prod_coaching_session", recurring: null },
  [FAKE_STRIPE_PRICES.standard]: { amount: 1900, product: FAKE_STRIPE_PRODUCTS.standard, recurring: MONTHLY },
  [FAKE_STRIPE_PRICES.premium]: { amount: 3900, product: FAKE_STRIPE_PRODUCTS.premium, recurring: MONTHLY },
  [FAKE_STRIPE_PRICES.essential]: { amount: 2900, product: FAKE_STRIPE_PRODUCTS.essential, recurring: MONTHLY },
  [FAKE_STRIPE_PRICES.bundleStandard]: { amount: 1900, product: "prod_bundle", recurring: MONTHLY },
  [FAKE_STRIPE_PRICES.bundlePremium]: { amount: 3900, product: "prod_bundle", recurring: MONTHLY },
  price_standard_yearly: { amount: 19000, product: FAKE_STRIPE_PRODUCTS.standard, recurring: { interval: "year", interval_count: 1 } },
  price_archived_monthly: { amount: 1500, product: FAKE_STRIPE_PRODUCTS.archived, recurring: MONTHLY },
  price_one_off: { amount: 5000, product: FAKE_STRIPE_PRODUCTS.oneOff, recurring: null },
  price_quarterly: { amount: 4500, product: FAKE_STRIPE_PRODUCTS.quarterly, recurring: { interval: "month", interval_count: 3 } },
};
const FAKE_PRODUCTS: Record<string, { active: boolean; defaultPrice: string | null }> = {
  [FAKE_STRIPE_PRODUCTS.standard]: { active: true, defaultPrice: FAKE_STRIPE_PRICES.standard },
  [FAKE_STRIPE_PRODUCTS.premium]: { active: true, defaultPrice: FAKE_STRIPE_PRICES.premium },
  [FAKE_STRIPE_PRODUCTS.essential]: { active: true, defaultPrice: FAKE_STRIPE_PRICES.essential },
  [FAKE_STRIPE_PRODUCTS.archived]: { active: false, defaultPrice: "price_archived_monthly" },
  [FAKE_STRIPE_PRODUCTS.oneOff]: { active: true, defaultPrice: "price_one_off" },
  [FAKE_STRIPE_PRODUCTS.noPrice]: { active: true, defaultPrice: null },
  [FAKE_STRIPE_PRODUCTS.quarterly]: { active: true, defaultPrice: "price_quarterly" },
};

/** The Stripe customer id the fake gives the person with this email, so tests can address webhooks to them. */
export function fakeCustomerId(email: string): string {
  return `cus_fake_${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;
}

/** Starts the fake on `port` (any free port by default). */
export async function startFakeStripe(port = 0) {
  const calls: StripeCall[] = [];
  const forgotten = new Set<string>();
  /** Default Prices changed by `setDefaultPrice`, by product. */
  const defaultPrices = new Map<string, string>();
  let silent = false;
  let sequence = 0;
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const path = new URL(request.url ?? "/", "http://stripe.test").pathname;
      const params = new URLSearchParams(body);
      calls.push({ method: request.method ?? "GET", path, params });
      if (silent) return; // an outage where Stripe takes the request and never answers
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
      if (price && FAKE_PRICES[price]) {
        const { amount, product, recurring } = FAKE_PRICES[price];
        return reply(200, { id: price, object: "price", active: true, unit_amount: amount, currency: "eur", recurring, product });
      }
      const product = request.method === "GET" && path.match(/^\/v1\/products\/([^/]+)$/)?.[1];
      if (product && FAKE_PRODUCTS[product]) {
        const { active, defaultPrice } = FAKE_PRODUCTS[product];
        return reply(200, { id: product, object: "product", active, default_price: defaultPrices.get(product) ?? defaultPrice });
      }
      if (product) return reply(404, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such product: '${product}'` } });
      if (request.method === "GET" && path === "/__calls") return reply(200, calls.map((call) => ({ ...call, params: Object.fromEntries(call.params) })));
      reply(404, { error: { type: "invalid_request_error", message: `fake Stripe has no ${request.method} ${path}` } });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    /** Makes a product's default Price another of its Prices, as an Administrator does in the Stripe Dashboard. */
    setDefaultPrice: (product: string, price: string) => void defaultPrices.set(product, price),
    /** Makes the fake answer as if the customer had been deleted on Stripe's side. */
    forgetCustomer: (customer: string) => void forgotten.add(customer),
    /** Makes the fake take every request from now on and never answer it, as a hanging Stripe does. */
    stopAnswering: () => void (silent = true),
    /** Calls made to one endpoint, e.g. "/v1/checkout/sessions". */
    callsTo: (path: string) => calls.filter((call) => call.path === path),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections(); // requests left hanging by stopAnswering
      }),
  };
}

export type FakeStripe = Awaited<ReturnType<typeof startFakeStripe>>;

let eventSequence = 0;

/**
 * A `customer.subscription.*` event as Stripe sends it, reduced to the fields that matter.
 * As on Stripe API versions since 2025-03-31.basil, the paid period's end is on the
 * subscription item (a month after the event unless `currentPeriodEnd` says otherwise).
 * A cancellation scheduled in the customer portal sets `cancelAtPeriodEnd`; one at
 * another date sets `cancelAt`. The Price's `product` is its Plan's for a known Price, unless `product` says otherwise.
 */
export function subscriptionEvent(
  type: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted",
  subscription: { customer: string; price: string; product?: string; status: string; id?: string; currentPeriodEnd?: Date; cancelAtPeriodEnd?: boolean; cancelAt?: Date },
  createdAt: Date = new Date(),
) {
  eventSequence += 1;
  const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
  const periodEnd = subscription.currentPeriodEnd ?? new Date(createdAt.getTime() + 30 * 24 * 3600_000);
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
        cancel_at: subscription.cancelAt ? seconds(subscription.cancelAt) : null,
        cancel_at_period_end: subscription.cancelAtPeriodEnd ?? false,
        items: {
          object: "list",
          data: [{ id: `si_fake${eventSequence}`, price: { id: subscription.price, product: subscription.product ?? FAKE_PRICES[subscription.price]?.product ?? "prod_other" }, current_period_end: seconds(periodEnd) }],
        },
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
