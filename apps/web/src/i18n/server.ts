import { createI18n, DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@jobhub/shared/i18n";
import { getCurrentCandidate } from "@/auth/server";

/** Interface Language for a request: the signed-in Candidate's setting, otherwise French. */
export async function getRequestLocale(): Promise<Locale> {
  const candidate = await getCurrentCandidate();
  const language: unknown = candidate?.interfaceLanguage;
  return isSupportedLocale(language) ? language : DEFAULT_LOCALE;
}

export async function getServerT(locale?: Locale) {
  return createI18n(locale ?? (await getRequestLocale())).t;
}
