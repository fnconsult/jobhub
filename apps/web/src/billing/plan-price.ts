import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { PlanPrice } from "./index";

/** How a Plan's price reads in the Interface Language: "19 € / mois", "€19 / month", "14,90 € / mois". */
export function planPriceLabel(price: PlanPrice, locale: Locale): string {
  const units = price.amount / 100;
  const amount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: price.currency,
    // Whole amounts read without cents: "19 €", not "19,00 €".
    ...(Number.isInteger(units) && { minimumFractionDigits: 0 }),
  }).format(units);
  return createI18n(locale).t(`billing.pricePer.${price.interval}`, { price: amount });
}
