import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { PlanPrice } from "./index";

/** How a Plan's price reads in the Interface Language: "19 € / mois", "€19 / month", "14,90 € / mois". */
export function planPriceLabel(price: PlanPrice, locale: Locale): string {
  const amount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: price.currency,
    trailingZeroDisplay: "stripIfInteger",
  }).format(price.amount / 100);
  return createI18n(locale).t(`billing.pricePer.${price.interval}`, { price: amount });
}
