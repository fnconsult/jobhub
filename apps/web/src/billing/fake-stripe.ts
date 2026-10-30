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

type FakePrice = { amount: number; product: string; recurring: { interval: string; interval_count: number } | null; currency?: string };
const MONTHLY = { interval: "month", interval_count: 1 };
const FAKE_PRICES: Record<string, FakePrice> = {
  [FAKE_STRIPE_COACHING_SESSION_PRICES.regular]: { amount: 9000, product: "prod_coaching_session", recurring: null },
  [FAKE_STRIPE_COACHING_SESSION_PRICES.discounted]: { amount: 7200, product: "prod_coaching_session", recurring: null },
  [FAKE_STRIPE_PRICES.standard]: { amount: 1900, product: FAKE_STRIPE_PRODUCTS.standard, recurring: MONTHLY },
  [FAKE_STRIPE_PRICES.premium]: { amount: 3900, product: FAKE_STRIPE_PRODUCTS.premium, recurring: MONTHLY },
  [FAKE_STRIPE_PRICES.essential]: { amount: 2900, product: FAKE_STRIPE_PRODUCTS.essential, recurring: MONTHLY },
  [FAKE_STRIPE_PRICES.bundleStandard]: { amount: 1900, product: "prod_bundle", recurring: MONTHLY },
  [FAKE_STRIPE_PRICES.bundlePremium]: { amount: 3900, product: "prod_bundle", recurring: MONTHLY },
  /** Premium priced in dollars, for a Plan Stripe sells in another currency. */
  price_premium_usd: { amount: 4500, product: FAKE_STRIPE_PRODUCTS.premium, recurring: MONTHLY, currency: "usd" },
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

/** A coupon as the fake keeps it: its Stripe fields. */
type FakeCoupon = {
  id: string;
  object: "coupon";
  name: string | null;
  percent_off: number | null;
  amount_off: number | null;
  currency: string | null;
  duration: string;
  duration_in_months: number | null;
  applies_to: { products: string[] };
  valid: boolean;
};
/** A promotion code as the fake keeps it; its coupon is always given expanded. */
type FakePromotionCode = {
  id: string;
  code: string;
  /** Null for a promotion code Stripe gives without its coupon (malformed). */
  coupon: string | null;
  active: boolean;
  expires_at: number | null;
  max_redemptions: number | null;
  first_time_transaction: boolean;
  times_redeemed: number;
};

/** The Stripe fields a form-encoded list (`applies_to[products][0]`, ...) holds under `prefix`, in order. */
const listParam = (params: URLSearchParams, prefix: string) =>
  [...params.keys()]
    .filter((key) => key.startsWith(`${prefix}[`))
    .sort((a, b) => Number(a.slice(prefix.length + 1, -1)) - Number(b.slice(prefix.length + 1, -1)))
    .map((key) => params.get(key)!);
const numberParam = (params: URLSearchParams, name: string) => (params.has(name) ? Number(params.get(name)) : null);

/** A refund as the fake keeps it: its Stripe fields. */
export type FakeRefund = {
  id: string;
  object: "refund";
  amount: number;
  currency: string;
  payment_intent: string;
  reason: string | null;
  status: "succeeded" | "pending" | "failed";
  metadata: Record<string, string>;
};

/** Starts the fake on `port` (any free port by default). */
export async function startFakeStripe(port = 0) {
  const calls: StripeCall[] = [];
  const coupons = new Map<string, FakeCoupon>();
  const promotionCodes = new Map<string, FakePromotionCode>();
  const promotionCodeJson = (promotionCode: FakePromotionCode) => ({
    id: promotionCode.id,
    object: "promotion_code",
    active: promotionCode.active,
    code: promotionCode.code,
    created: 0,
    customer: null,
    expires_at: promotionCode.expires_at,
    max_redemptions: promotionCode.max_redemptions,
    metadata: {},
    promotion: { type: "coupon", coupon: promotionCode.coupon === null ? null : coupons.get(promotionCode.coupon) },
    restrictions: { first_time_transaction: promotionCode.first_time_transaction, minimum_amount: null, minimum_amount_currency: null },
    times_redeemed: promotionCode.times_redeemed,
  });
  const forgotten = new Set<string>();
  /** Default Prices changed by `setDefaultPrice`, by product. */
  const defaultPrices = new Map<string, string>();
  let silent = false;
  /** Customers who have paid something already: a first-payment-only code is refused to them at Checkout. */
  const paidCustomers = new Set<string>();
  /** Adds a promotion code with its coupon (10 % off, no product restriction), or a malformed one without. */
  function addPromotionCode(code: string, malformed = false): FakePromotionCode {
    const id = ++sequence;
    const coupon: FakeCoupon = { id: `coupon_fake${id}`, object: "coupon", name: code, percent_off: 10, amount_off: null, currency: null, duration: "once", duration_in_months: null, applies_to: { products: [] }, valid: true };
    coupons.set(coupon.id, coupon);
    const promotionCode: FakePromotionCode = { id: `promo_fake${id}`, code, coupon: malformed ? null : coupon.id, active: true, expires_at: null, max_redemptions: null, first_time_transaction: false, times_redeemed: 0 };
    promotionCodes.set(promotionCode.id, promotionCode);
    return promotionCode;
  }
  /** Why Checkout refuses `discounts[0][promotion_code]` for this session, as Stripe would; null when it applies. */
  function discountRefusal(params: URLSearchParams): string | null {
    const promotionCode = promotionCodes.get(params.get("discounts[0][promotion_code]")!);
    if (!promotionCode || !promotionCode.active || promotionCode.coupon === null) return "This promotion code is not active.";
    if (promotionCode.expires_at !== null && promotionCode.expires_at * 1000 <= Date.now()) return "This promotion code has expired.";
    if (promotionCode.max_redemptions !== null && promotionCode.times_redeemed >= promotionCode.max_redemptions) return "This promotion code has been used up.";
    const products = coupons.get(promotionCode.coupon)?.applies_to.products ?? [];
    const price = FAKE_PRICES[params.get("line_items[0][price]") ?? ""];
    if (products.length > 0 && (!price || !products.includes(price.product))) return "This promotion code cannot be applied to the items in this session.";
    if (promotionCode.first_time_transaction && paidCustomers.has(params.get("customer") ?? "")) return "This promotion code cannot be redeemed because the associated customer has prior transactions.";
    return null;
  }
  /** The discount each subscription has, by subscription id: its promotion code and when it ends. */
  const subscriptionDiscounts = new Map<string, { promotionCode: string; end: number | null }>();
  /** When each subscription started (Stripe's `start_date`, in seconds), by subscription id; cancelled ones. */
  const subscriptionStarts = new Map<string, number>();
  const cancelledSubscriptions = new Set<string>();
  /** The paid invoices of each subscription, by subscription id: their amount and the PaymentIntent they were paid with (none at 0). */
  const invoices = new Map<string, { id: string; amount: number; paymentIntent: string | null }[]>();
  /** What each paid Checkout Session (a Coaching Session's) was paid with, by its id. */
  const checkoutPayments = new Map<string, { paymentIntent: string; amount: number }>();
  /** Every PaymentIntent the fake took, and how much. */
  const paymentAmounts = new Map<string, number>();
  const refunds: FakeRefund[] = [];
  /** Refund answers by idempotency key: a request sent again with its key gets the same answer, as from Stripe. */
  const refundAnswers = new Map<string, { status: number; json: unknown }>();
  /** The error code every refund is refused with, while set. */
  let refundRefusal: string | null = null;
  let sequence = 0;
  function payInvoice(subscriptionId: string, amount: number): string {
    const id = ++sequence;
    const paymentIntent = amount > 0 ? `pi_fake${id}` : null;
    if (paymentIntent) paymentAmounts.set(paymentIntent, amount);
    invoices.set(subscriptionId, [...(invoices.get(subscriptionId) ?? []), { id: `in_fake${id}`, amount, paymentIntent }]);
    return paymentIntent ?? "";
  }
  function payCheckoutSession(checkoutSessionId: string, amount: number): string {
    const paymentIntent = `pi_fake${++sequence}`;
    paymentAmounts.set(paymentIntent, amount);
    checkoutPayments.set(checkoutSessionId, { paymentIntent, amount });
    return paymentIntent;
  }
  /** Refunds a PaymentIntent as Stripe does: in full unless `amount` says less, never more than is left. */
  function createRefund(params: URLSearchParams): { status: number; json: unknown } {
    const refusal = (code: string, message: string, status = 400) => ({ status, json: { error: { type: "invalid_request_error", code, message } } });
    if (refundRefusal) return refusal(refundRefusal, `Refund refused: ${refundRefusal}`);
    const paymentIntent = params.get("payment_intent") ?? "";
    const paid = paymentAmounts.get(paymentIntent);
    if (paid === undefined) return refusal("resource_missing", `No such payment_intent: '${paymentIntent}'`, 404);
    const refunded = refunds.filter((refund) => refund.payment_intent === paymentIntent && refund.status !== "failed").reduce((sum, refund) => sum + refund.amount, 0);
    const amount = numberParam(params, "amount") ?? paid - refunded;
    if (amount <= 0 || refunded + amount > paid) return refusal("charge_already_refunded", `PaymentIntent ${paymentIntent} has already been refunded.`);
    const metadata = Object.fromEntries([...params].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice("metadata[".length, -1), value]));
    const refund: FakeRefund = { id: `re_fake${++sequence}`, object: "refund", amount, currency: "eur", payment_intent: paymentIntent, reason: params.get("reason"), status: "succeeded", metadata };
    refunds.push(refund);
    return { status: 200, json: refund };
  }
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
      if (request.method === "POST" && path === "/v1/coupons") {
        const coupon: FakeCoupon = {
          id: `coupon_fake${id}`,
          object: "coupon",
          name: params.get("name"),
          percent_off: numberParam(params, "percent_off"),
          amount_off: numberParam(params, "amount_off"),
          currency: params.get("currency"),
          duration: params.get("duration") ?? "once",
          duration_in_months: numberParam(params, "duration_in_months"),
          applies_to: { products: listParam(params, "applies_to[products]") },
          valid: true,
        };
        coupons.set(coupon.id, coupon);
        return reply(200, coupon);
      }
      const couponPath = path.match(/^\/v1\/coupons\/([^/]+)$/);
      if (request.method === "DELETE" && couponPath) {
        coupons.delete(decodeURIComponent(couponPath[1]!));
        return reply(200, { id: couponPath[1], object: "coupon", deleted: true });
      }
      if (request.method === "POST" && path === "/v1/promotion_codes") {
        const code = params.get("code") ?? `CODE${id}`;
        if ([...promotionCodes.values()].some((other) => other.active && other.code.toUpperCase() === code.toUpperCase())) {
          return reply(400, { error: { type: "invalid_request_error", param: "code", message: "An active promotion code with this code already exists." } });
        }
        const coupon = params.get("promotion[coupon]") ?? "";
        if (!coupons.has(coupon)) return reply(400, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such coupon: '${coupon}'` } });
        const promotionCode: FakePromotionCode = {
          id: `promo_fake${id}`,
          code,
          coupon,
          active: params.get("active") !== "false",
          expires_at: numberParam(params, "expires_at"),
          max_redemptions: numberParam(params, "max_redemptions"),
          first_time_transaction: params.get("restrictions[first_time_transaction]") === "true",
          times_redeemed: 0,
        };
        promotionCodes.set(promotionCode.id, promotionCode);
        return reply(200, promotionCodeJson(promotionCode));
      }
      if (request.method === "GET" && path === "/v1/promotion_codes") {
        const query = new URL(request.url ?? "/", "http://stripe.test").searchParams;
        const code = query.get("code");
        const active = query.get("active");
        // Newest first, as Stripe lists them, a page at a time after `starting_after`.
        const matching = [...promotionCodes.values()]
          .reverse()
          .filter((each) => (code === null || each.code.toUpperCase() === code.toUpperCase()) && (active === null || String(each.active) === active));
        const after = query.get("starting_after");
        const from = after ? matching.findIndex((each) => each.id === after) + 1 : 0;
        const limit = Number(query.get("limit") ?? 10);
        const page = matching.slice(from, from + limit);
        return reply(200, { object: "list", url: "/v1/promotion_codes", has_more: from + limit < matching.length, data: page.map(promotionCodeJson) });
      }
      const promotionCodePath = path.match(/^\/v1\/promotion_codes\/([^/]+)$/);
      if (promotionCodePath) {
        const promotionCode = promotionCodes.get(decodeURIComponent(promotionCodePath[1]!));
        if (!promotionCode) return reply(404, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such promotion code: '${promotionCodePath[1]}'` } });
        if (request.method === "POST" && params.has("active")) promotionCode.active = params.get("active") === "true";
        return reply(200, promotionCodeJson(promotionCode));
      }
      if (request.method === "POST" && path === "/v1/checkout/sessions") {
        const discounted = params.has("discounts[0][promotion_code]");
        if (discounted && params.get("allow_promotion_codes") === "true") {
          return reply(400, { error: { type: "invalid_request_error", message: "You may only specify one of these parameters: allow_promotion_codes, discounts." } });
        }
        const refusal = discounted ? discountRefusal(params) : null;
        if (refusal) return reply(400, { error: { type: "invalid_request_error", param: "discounts", message: refusal } });
        return reply(200, { id: `cs_fake${id}`, object: "checkout.session", url: `https://checkout.stripe.test/cs_fake${id}` });
      }
      if (request.method === "POST" && path === "/v1/billing_portal/sessions") {
        return reply(200, { id: `bps_fake${id}`, object: "billing_portal.session", url: `https://billing.stripe.test/bps_fake${id}` });
      }
      const cancelled = request.method === "DELETE" && path.match(/^\/v1\/subscriptions\/([^/]+)$/)?.[1];
      if (cancelled) {
        cancelledSubscriptions.add(decodeURIComponent(cancelled));
        return reply(200, { id: cancelled, object: "subscription", status: "canceled" });
      }
      if (request.method === "GET" && path === "/v1/invoices") {
        const query = new URL(request.url ?? "/", "http://stripe.test").searchParams;
        const of = query.get("subscription") ?? "";
        const data = (invoices.get(of) ?? []).map((invoice) => ({
          id: invoice.id,
          object: "invoice",
          status: "paid",
          subscription: of,
          amount_paid: invoice.amount,
          currency: "eur",
          payments: {
            object: "list",
            has_more: false,
            data: invoice.paymentIntent
              ? [{ id: `inpay_${invoice.id}`, object: "invoice_payment", amount_paid: invoice.amount, currency: "eur", status: "paid", payment: { type: "payment_intent", payment_intent: invoice.paymentIntent } }]
              : [],
          },
        }));
        return reply(200, { object: "list", url: "/v1/invoices", has_more: false, data });
      }
      const checkoutSession = request.method === "GET" && path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/)?.[1];
      if (checkoutSession) {
        const paid = checkoutPayments.get(decodeURIComponent(checkoutSession));
        if (!paid) return reply(404, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such checkout.session: '${checkoutSession}'` } });
        return reply(200, { id: checkoutSession, object: "checkout.session", mode: "payment", payment_status: "paid", payment_intent: paid.paymentIntent, amount_total: paid.amount, currency: "eur" });
      }
      if (request.method === "POST" && path === "/v1/refunds") {
        const key = request.headers["idempotency-key"];
        const answer = (typeof key === "string" && refundAnswers.get(key)) || createRefund(params);
        if (typeof key === "string") refundAnswers.set(key, answer);
        return reply(answer.status, answer.json);
      }
      const subscription = request.method === "GET" && path.match(/^\/v1\/subscriptions\/([^/]+)$/)?.[1];
      if (subscription) {
        const discount = subscriptionDiscounts.get(subscription);
        const promotionCode = discount && promotionCodes.get(discount.promotionCode);
        const discounts = promotionCode
          ? [
              {
                id: `di_fake_${subscription}`,
                object: "discount",
                start: 0,
                end: discount.end,
                promotion_code: promotionCode.id,
                source: { type: "coupon", coupon: promotionCode.coupon === null ? null : coupons.get(promotionCode.coupon) },
                subscription,
              },
            ]
          : [];
        const started = subscriptionStarts.get(subscription);
        return reply(200, { id: subscription, object: "subscription", status: cancelledSubscriptions.has(subscription) ? "canceled" : "active", discounts, ...(started === undefined ? {} : { start_date: started }) });
      }
      const price = request.method === "GET" && path.match(/^\/v1\/prices\/([^/]+)$/)?.[1];
      if (price && FAKE_PRICES[price]) {
        const { amount, product, recurring } = FAKE_PRICES[price];
        return reply(200, { id: price, object: "price", active: true, unit_amount: amount, currency: FAKE_PRICES[price].currency ?? "eur", recurring, product });
      }
      const product = request.method === "GET" && path.match(/^\/v1\/products\/([^/]+)$/)?.[1];
      if (product && FAKE_PRODUCTS[product]) {
        const { active, defaultPrice } = FAKE_PRODUCTS[product];
        const priceId = defaultPrices.get(product) ?? defaultPrice;
        // `expand[]=default_price` (as the SDK sends it in the query string) gives the Price itself.
        const expanded = decodeURIComponent(new URL(request.url ?? "/", "http://stripe.test").search).includes("default_price");
        const known = priceId ? FAKE_PRICES[priceId] : undefined;
        const defaultPriceField =
          expanded && priceId && known
            ? { id: priceId, object: "price", active: true, unit_amount: known.amount, currency: known.currency ?? "eur", recurring: known.recurring, product: known.product }
            : priceId;
        return reply(200, { id: product, object: "product", active, default_price: defaultPriceField });
      }
      if (product) return reply(404, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such product: '${product}'` } });
      // For e2e specs in another process: `discountSubscription` over HTTP.
      const discountPath = request.method === "POST" && path.match(/^\/__subscriptions\/([^/]+)\/discount$/)?.[1];
      if (discountPath) {
        subscriptionDiscounts.set(decodeURIComponent(discountPath), { promotionCode: params.get("promotion_code") ?? "", end: numberParam(params, "end") });
        return reply(200, {});
      }
      const paidPath = request.method === "POST" && path.match(/^\/__customers\/([^/]+)\/paid$/)?.[1];
      if (paidPath) {
        paidCustomers.add(decodeURIComponent(paidPath));
        return reply(200, {});
      }
      // For e2e specs in another process: `payInvoice`, `payCheckoutSession`, `refuseRefunds` and `refunds` over HTTP.
      const invoicePath = request.method === "POST" && path.match(/^\/__subscriptions\/([^/]+)\/invoices$/)?.[1];
      if (invoicePath) return reply(200, { payment_intent: payInvoice(decodeURIComponent(invoicePath), Number(params.get("amount") ?? 0)) });
      const checkoutPaymentPath = request.method === "POST" && path.match(/^\/__checkout_sessions\/([^/]+)\/payment$/)?.[1];
      if (checkoutPaymentPath) return reply(200, { payment_intent: payCheckoutSession(decodeURIComponent(checkoutPaymentPath), Number(params.get("amount") ?? 0)) });
      if (request.method === "POST" && path === "/__refunds/refuse") {
        refundRefusal = params.get("code") || null;
        return reply(200, {});
      }
      if (request.method === "GET" && path === "/__refunds") return reply(200, refunds);
      const promotionCodesPath = request.method === "GET" && path === "/__promotion_codes";
      if (promotionCodesPath) return reply(200, [...promotionCodes.values()].map(promotionCodeJson));
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
    /** Counts one redemption of a promotion code, as a completed Checkout does. */
    redeem: (promotionCodeId: string) => {
      const promotionCode = promotionCodes.get(promotionCodeId);
      if (promotionCode) promotionCode.times_redeemed += 1;
    },
    /** Records that a customer has paid something (a Coaching Session, say): first-payment-only codes are refused to them. */
    markPaid: (customer: string) => void paidCustomers.add(customer),
    /** Adds a promotion code made outside the Back Office (in the Stripe Dashboard, say). */
    addPromotionCode: (code: string) => addPromotionCode(code),
    /** Adds a promotion code Stripe gives without its coupon. */
    addMalformedPromotionCode: (code: string) => addPromotionCode(code, true),
    /** Gives a subscription the discount of a promotion code, ending at `end` (null: as long as the subscription). */
    discountSubscription: (subscriptionId: string, promotionCodeId: string, end: Date | null) =>
      void subscriptionDiscounts.set(subscriptionId, { promotionCode: promotionCodeId, end: end && Math.floor(end.getTime() / 1000) }),
    /** Sets when a subscription started (Stripe's `start_date`), as Stripe gives it when asked. */
    setSubscriptionStart: (subscriptionId: string, startedAt: Date) => void subscriptionStarts.set(subscriptionId, Math.floor(startedAt.getTime() / 1000)),
    /** Records a paid invoice of a subscription (`amount` 0: a 100 % code, nothing taken); returns the PaymentIntent it was paid with ("" at 0). */
    payInvoice,
    /** Records a paid Checkout Session (a Coaching Session's); returns the PaymentIntent it was paid with. */
    payCheckoutSession,
    /** Makes Stripe refuse every refund with this error code from now on (null: refunds go through again). */
    refuseRefunds: (code: string | null) => void (refundRefusal = code),
    /** Every refund made, oldest first. */
    refunds: () => [...refunds],
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
  subscription: {
    customer: string;
    price: string;
    product?: string;
    status: string;
    id?: string;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
    cancelAt?: Date;
    /** The card it is charged to; null for one started with a 100 % Coupon and no card. A card by default. */
    defaultPaymentMethod?: string | null;
    /** When Stripe started it (`start_date`): the event's time by default. */
    startDate?: Date;
  },
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
        start_date: seconds(subscription.startDate ?? createdAt),
        default_payment_method: subscription.defaultPaymentMethod === undefined ? "pm_card_fake" : subscription.defaultPaymentMethod,
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

/** A `refund.*` event as Stripe sends it, reduced to the fields that matter. */
export function refundEvent(
  type: "refund.created" | "refund.updated" | "refund.failed",
  refund: { id: string; paymentIntent: string; amount: number; status: "pending" | "succeeded" | "failed" | "canceled" | "requires_action"; failureReason?: string },
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
        id: refund.id,
        object: "refund",
        amount: refund.amount,
        currency: "eur",
        payment_intent: refund.paymentIntent,
        status: refund.status,
        failure_reason: refund.failureReason ?? null,
        metadata: {},
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
