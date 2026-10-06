import { createI18n, DEFAULT_LOCALE, type Locale } from "@jobhub/shared/i18n";

/** Interface language for a request. French until locale negotiation lands. */
export function getRequestLocale(): Locale {
  return DEFAULT_LOCALE;
}

export function getServerT(locale: Locale = getRequestLocale()) {
  return createI18n(locale).t;
}
