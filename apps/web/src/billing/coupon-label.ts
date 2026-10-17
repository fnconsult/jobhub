import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { ActiveDiscount, CouponDiscount, CouponDuration } from "./coupons";

/** "50 %" or "5 €" (cents kept when there are some), in the Interface Language. */
function amountOff(discount: CouponDiscount, locale: Locale): string {
  if ("percentOff" in discount) return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(discount.percentOff / 100);
  const units = discount.amountOff / 100;
  return new Intl.NumberFormat(locale, { style: "currency", currency: discount.currency, ...(Number.isInteger(units) && { minimumFractionDigits: 0 }) }).format(units);
}

/** How a Coupon's terms read: "−50 % pendant 3 mois", "€5 off the first payment". */
export function couponTermsLabel({ discount, duration }: { discount: CouponDiscount; duration: CouponDuration }, locale: Locale): string {
  const { t } = createI18n(locale);
  const off = amountOff(discount, locale);
  if (duration === "once") return t("billing.coupon.once", { off });
  if (duration === "forever") return t("billing.coupon.forever", { off });
  return t("billing.coupon.months", { off, count: duration.months });
}

/**
 * What the subscription page says of the discount the Candidate's subscription is getting:
 * "Réduction en cours : −50 % jusqu'au 15 janvier 2027" (the day in French time), or its terms when it has no end.
 */
export function activeDiscountLabel(active: ActiveDiscount, locale: Locale): string {
  const { t } = createI18n(locale);
  if (!active.endsAt) return t("billing.coupon.active", { terms: couponTermsLabel(active, locale) });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(active.endsAt);
  return t("billing.coupon.activeUntil", { off: amountOff(active.discount, locale), date });
}
