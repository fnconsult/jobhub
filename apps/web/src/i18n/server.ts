import { createI18n, DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@jobhub/shared/i18n";
import { headers } from "next/headers";
import { getCurrentCandidate } from "@/auth/server";
import { LOCALE_HEADER, VISITOR_LOCALE_HEADER } from "./locale-header";

/** A Candidate's Interface Language, or French for a Guest (or an unsupported setting). */
export function localeOf(candidate: { interfaceLanguage?: unknown } | null | undefined): Locale {
  const language = candidate?.interfaceLanguage;
  return isSupportedLocale(language) ? language : DEFAULT_LOCALE;
}

/**
 * Interface Language for a request: the one its URL chose (see LOCALE_HEADER),
 * else the signed-in Candidate's setting, else a Visitor's choice in the URL
 * (VISITOR_LOCALE_HEADER), otherwise French.
 */
export async function getRequestLocale(): Promise<Locale> {
  const chosen = (await headers()).get(LOCALE_HEADER);
  if (isSupportedLocale(chosen)) return chosen;
  const candidate = await getCurrentCandidate();
  if (candidate) return localeOf(candidate);
  const visitor = (await headers()).get(VISITOR_LOCALE_HEADER);
  return isSupportedLocale(visitor) ? visitor : DEFAULT_LOCALE;
}

/** The language the request's URL chose with `lang`, for the public shell's links to carry on (#544); none otherwise. */
export async function getUrlLocale(): Promise<Locale | undefined> {
  const all = await headers();
  const chosen = all.get(LOCALE_HEADER) ?? all.get(VISITOR_LOCALE_HEADER);
  return isSupportedLocale(chosen) ? chosen : undefined;
}

export async function getServerT(locale?: Locale) {
  return createI18n(locale ?? (await getRequestLocale())).t;
}
