import { createI18n, DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@jobhub/shared/i18n";
import { getCurrentCandidate } from "@/auth/server";

/** A Candidate's Interface Language, or French for a Guest (or an unsupported setting). */
export function localeOf(candidate: { interfaceLanguage?: unknown } | null | undefined): Locale {
  const language = candidate?.interfaceLanguage;
  return isSupportedLocale(language) ? language : DEFAULT_LOCALE;
}

/** Interface Language for a request: the signed-in Candidate's setting, otherwise French. */
export async function getRequestLocale(): Promise<Locale> {
  return localeOf(await getCurrentCandidate());
}

export async function getServerT(locale?: Locale) {
  return createI18n(locale ?? (await getRequestLocale())).t;
}
