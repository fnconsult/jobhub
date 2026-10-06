import i18next, { type i18n } from "i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const DEFAULT_LOCALE = "fr";
export const SUPPORTED_LOCALES = ["fr", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Interface translations. The French catalogue is the reference. */
export const resources = {
  fr: { translation: fr },
  en: { translation: en },
} satisfies Record<Locale, { translation: typeof fr }>;

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Creates a ready-to-use, isolated i18next instance for the interface
 * language. Resources are bundled, so the instance is usable synchronously.
 * Unsupported or missing locales fall back to French.
 */
export function createI18n(locale?: string | null): i18n {
  const instance = i18next.createInstance();
  void instance.init({
    resources,
    lng: isSupportedLocale(locale) ? locale : DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
  });
  return instance;
}

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof fr };
  }
}
