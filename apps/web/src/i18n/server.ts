import { createI18n, DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@jobhub/shared/i18n";
import { headers } from "next/headers";
import { getCurrentCandidate } from "@/auth/server";
import { LOCALE_HEADER } from "./locale-header";

/** A Candidate's Interface Language, or French for a Guest (or an unsupported setting). */
export function localeOf(candidate: { interfaceLanguage?: unknown } | null | undefined): Locale {
  const language = candidate?.interfaceLanguage;
  return isSupportedLocale(language) ? language : DEFAULT_LOCALE;
}

/**
 * Interface Language for a request: the one its URL chose (see LOCALE_HEADER),
 * else the signed-in Candidate's setting, otherwise French.
 */
export async function getRequestLocale(): Promise<Locale> {
  const chosen = (await headers()).get(LOCALE_HEADER);
  return isSupportedLocale(chosen) ? chosen : localeOf(await getCurrentCandidate());
}

export async function getServerT(locale?: Locale) {
  return createI18n(locale ?? (await getRequestLocale())).t;
}
