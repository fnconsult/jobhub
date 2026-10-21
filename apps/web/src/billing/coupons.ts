/**
 * Coupons (CONTEXT.md, ADR-0014 addendum #207), behind the billing module: callers go
 * through `createBilling(...)` (`coupons`, `createCoupon`, `deactivateCoupon`,
 * `checkPromotionCode`, `activeDiscount`, and `startCheckout`'s promotion code), never
 * through this file.
 *
 * A Coupon is a Stripe coupon (the terms: so much off, for so long, on which Plans'
 * products) and its one promotion code (what a Candidate types, with its expiry, its
 * maximum redemptions and whether it is for a first subscription only). Stripe is the
 * source of truth: nothing of a Coupon is kept in our database, and its redemptions are
 * Stripe's count. The Back Office creates them (the only thing it creates in Stripe)
 * and deactivates them; a deactivated code can no longer be redeemed, while discounts
 * already given run their course.
 */
import { FREE_PLAN, type Failure, type Plan } from "@jobhub/shared";
import Stripe from "stripe";
import * as z from "zod";
import type { PlanDefinition } from "./plans";

/** What a Coupon takes off each charge: a percentage, or an amount in the currency's smallest unit (cents). */
export type CouponDiscount = { percentOff: number } | { amountOff: number; currency: string };

/** For how long a Coupon's discount applies: the first charge only, a number of months, or as long as the subscription lasts. */
export type CouponDuration = "once" | "forever" | { months: number };

/** A Coupon as the Back Office lists it, read from Stripe. */
export interface Coupon {
  /** Its Stripe promotion code's id (`promo_…`). */
  id: string;
  /** What Candidates type, in upper case. */
  code: string;
  discount: CouponDiscount;
  duration: CouponDuration;
  /** The Plans it applies to; null for every Plan (a code made in Stripe without products). */
  plans: Plan[] | null;
  expiresAt: Date | null;
  maxRedemptions: number | null;
  /**
   * Stripe's first-time-transaction restriction: refused to a customer who has already paid anything,
   * a Coaching Session included. Not "first subscription".
   */
  firstPaymentOnly: boolean;
  /** How many times it was redeemed, as Stripe counts. */
  timesRedeemed: number;
  /** Whether it can still be redeemed: not deactivated, nor expired, nor used up. */
  active: boolean;
}

/** A promotion code in the Back Office's list: a Coupon, or one Stripe gives without a readable coupon. */
export type ListedCoupon = Coupon | { id: string; code: string; unreadable: true };

/** The discount a Candidate's subscription is getting. */
export interface ActiveDiscount {
  discount: CouponDiscount;
  duration: CouponDuration;
  /** When it stops applying; null when it lasts as long as the subscription. */
  endsAt: Date | null;
}

/** Why the Back Office could not create or deactivate a Coupon. */
export type CouponError =
  /** 3 to 40 letters, digits, dashes or underscores. */
  | "invalid_code"
  /** Another active code is the same. */
  | "code_taken"
  /** Neither or both of a percentage (1 to 100) and an amount (above 0). */
  | "invalid_discount"
  /** Not once, forever, or 1 to 36 months. */
  | "invalid_duration"
  | "no_plan"
  /** Free, an unknown Plan or one with no Stripe product: no subscription to discount. */
  | "plan_not_sold"
  /** Not a date, or not after today. */
  | "invalid_expiry"
  | "invalid_max_redemptions"
  /** A fixed amount for as long as the subscription lasts, at or above an eligible Plan's price: that Plan free for good. */
  | "amount_covers_price"
  /** A fixed amount (in euros) on a Plan Stripe prices in another currency. */
  | "currency_not_eur"
  | "unknown_coupon"
  /** Stripe is not configured or could not be reached. */
  | "stripe_unavailable";

/** `failure`: Stripe's own error, when Stripe refused the write or did not answer (#263). */
export type CouponResult<T> = ({ ok: true } & T) | { ok: false; error: CouponError; failure?: Failure };

/** The currency of fixed-amount Coupons: Jobbbox's Plans are priced in euros. */
export const COUPON_CURRENCY = "eur";

const CODE = /^[A-Z0-9_-]{3,40}$/;
const MAX_MONTHS = 36;

/** A new Coupon, as the Back Office's form sends it (see coupon-form.ts). */
export const newCouponInput = z.object({
  code: z.string().trim().toUpperCase(),
  percentOff: z.number().nullish(),
  amountOff: z.number().nullish(),
  duration: z.string(),
  durationInMonths: z.number().nullish(),
  plans: z.array(z.string()),
  /** YYYY-MM-DD: the code works until the end of that day, in French time. */
  expiresAt: z.string().nullish(),
  maxRedemptions: z.number().nullish(),
  firstPaymentOnly: z.boolean(),
});

/** The end of a day (YYYY-MM-DD) in French time, or null when it is no date. */
export function endOfDayInFrance(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const noonUtc = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(noonUtc.getTime()) || noonUtc.toISOString().slice(0, 10) !== day) return null;
  // Paris is UTC+1 or UTC+2: the offset at noon that day holds at midnight too (clocks change at night).
  const parisNoon = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(noonUtc);
  const offsetHours = Number(parisNoon) - 12;
  return new Date(Date.parse(`${day}T23:59:59Z`) - offsetHours * 3600_000);
}

/** The Stripe parameters of a valid new Coupon, or the first thing wrong with it. */
export function couponParams(
  input: unknown,
  plans: PlanDefinition[],
  now: Date,
): CouponResult<{ coupon: Stripe.CouponCreateParams; promotionCode: Omit<Stripe.PromotionCodeCreateParams, "promotion"> }> {
  const parsed = newCouponInput.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "code") return { ok: false, error: "invalid_code" };
    if (field === "percentOff" || field === "amountOff") return { ok: false, error: "invalid_discount" };
    if (field === "duration" || field === "durationInMonths") return { ok: false, error: "invalid_duration" };
    if (field === "plans") return { ok: false, error: "no_plan" };
    if (field === "expiresAt") return { ok: false, error: "invalid_expiry" };
    if (field === "maxRedemptions") return { ok: false, error: "invalid_max_redemptions" };
    return { ok: false, error: "invalid_code" };
  }
  const { code, percentOff, amountOff, duration, durationInMonths, expiresAt, maxRedemptions, firstPaymentOnly } = parsed.data;
  if (!CODE.test(code)) return { ok: false, error: "invalid_code" };

  let discount: Pick<Stripe.CouponCreateParams, "percent_off" | "amount_off" | "currency">;
  if (percentOff != null && amountOff == null && Number.isFinite(percentOff) && percentOff > 0 && percentOff <= 100) {
    discount = { percent_off: percentOff };
  } else if (amountOff != null && percentOff == null && Number.isInteger(amountOff) && amountOff > 0) {
    discount = { amount_off: amountOff, currency: COUPON_CURRENCY };
  } else {
    return { ok: false, error: "invalid_discount" };
  }

  let length: Pick<Stripe.CouponCreateParams, "duration" | "duration_in_months">;
  if (duration === "once" || duration === "forever") length = { duration };
  else if (duration === "repeating" && Number.isInteger(durationInMonths) && durationInMonths! >= 1 && durationInMonths! <= MAX_MONTHS) {
    length = { duration, duration_in_months: durationInMonths! };
  } else return { ok: false, error: "invalid_duration" };

  const chosen = [...new Set(parsed.data.plans)];
  if (chosen.length === 0) return { ok: false, error: "no_plan" };
  const products: string[] = [];
  for (const key of chosen) {
    const plan = plans.find((each) => each.key === key);
    if (!plan || plan.key === FREE_PLAN || !plan.stripeProductId) return { ok: false, error: "plan_not_sold" };
    products.push(plan.stripeProductId);
  }

  let expires: Date | null = null;
  if (expiresAt) {
    expires = endOfDayInFrance(expiresAt);
    if (!expires || expires.getTime() <= now.getTime()) return { ok: false, error: "invalid_expiry" };
  }
  if (maxRedemptions != null && !(Number.isInteger(maxRedemptions) && maxRedemptions >= 1)) return { ok: false, error: "invalid_max_redemptions" };

  return {
    ok: true,
    coupon: { name: code, ...discount, ...length, applies_to: { products } },
    promotionCode: {
      code,
      ...(expires && { expires_at: Math.floor(expires.getTime() / 1000) }),
      ...(maxRedemptions != null && { max_redemptions: maxRedemptions }),
      restrictions: { first_time_transaction: firstPaymentOnly },
    },
  };
}

/** A Stripe coupon's discount and duration. */
export function termsOf(coupon: Stripe.Coupon): { discount: CouponDiscount; duration: CouponDuration } {
  const discount: CouponDiscount =
    coupon.percent_off !== null ? { percentOff: coupon.percent_off } : { amountOff: coupon.amount_off ?? 0, currency: coupon.currency ?? COUPON_CURRENCY };
  const duration: CouponDuration = coupon.duration === "repeating" ? { months: coupon.duration_in_months ?? 1 } : coupon.duration === "forever" ? "forever" : "once";
  return { discount, duration };
}

/**
 * A promotion code, its coupon expanded with `applies_to`, as the Back Office lists it.
 * `plans` maps Stripe products to Plans; a product no Plan holds is left out.
 */
export function couponOf(promotionCode: Stripe.PromotionCode, plans: PlanDefinition[], now: Date): Coupon {
  const coupon = promotionCode.promotion.coupon;
  if (!coupon || typeof coupon === "string") throw new Error(`Stripe promotion code ${promotionCode.id} came without its coupon`);
  const products = coupon.applies_to?.products;
  const expiresAt = promotionCode.expires_at === null ? null : new Date(promotionCode.expires_at * 1000);
  const usedUp = promotionCode.max_redemptions !== null && promotionCode.times_redeemed >= promotionCode.max_redemptions;
  return {
    id: promotionCode.id,
    code: promotionCode.code,
    ...termsOf(coupon),
    plans: products && products.length > 0 ? plans.filter((plan) => plan.stripeProductId && products.includes(plan.stripeProductId)).map((plan) => plan.key) : null,
    expiresAt,
    maxRedemptions: promotionCode.max_redemptions,
    firstPaymentOnly: promotionCode.restrictions.first_time_transaction,
    timesRedeemed: promotionCode.times_redeemed,
    active: promotionCode.active && coupon.valid && !usedUp && (expiresAt === null || expiresAt.getTime() > now.getTime()),
  };
}

/** A promotion code as the Back Office lists it: unreadable, rather than failing the list, when Stripe gives it without its coupon. */
export function listedCouponOf(promotionCode: Stripe.PromotionCode, plans: PlanDefinition[], now: Date): ListedCoupon {
  try {
    return couponOf(promotionCode, plans, now);
  } catch (error) {
    console.error(`[billing] Stripe promotion code ${promotionCode.id} could not be read`, error);
    return { id: promotionCode.id, code: promotionCode.code, unreadable: true };
  }
}
