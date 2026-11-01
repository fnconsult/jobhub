import { isSupportedLocale, type Locale } from "@jobhub/shared/i18n";

/**
 * Request header naming the Interface Language a page is shown in, when the URL's `lang` chooses it rather than the
 * signed-in Candidate (the Job Digest unsubscribe page, opened from an email in the Candidate's language; « Lire le
 * texte français » on a Legal Text; the FR/EN switch of a signed-in Candidate, #544, #545). Set only by
 * `src/proxy.ts`, which overwrites any value a client sent.
 */
export const LOCALE_HEADER = "x-jobhub-locale";

/**
 * Request header naming the language a Visitor reads the page in: the `/en` prefix of a public page (#545), or the
 * URL's `lang` on any other page (an error page under the public site's header, #544). It applies only when no
 * Candidate is signed in: a signed-in Candidate's Interface Language comes first (#501). Set only by `src/proxy.ts`.
 */
export const VISITOR_LOCALE_HEADER = "x-jobhub-visitor-locale";

/**
 * Request header naming the language of the page's URL (#545): `en` under `/en`, `fr` otherwise, or the one its
 * `lang` chose. What the public shell's links, `canonical` and `hreflang` follow. Set only by `src/proxy.ts`.
 */
export const URL_LOCALE_HEADER = "x-jobhub-url-locale";

/** The prefix of the public site in English (#545); French, the default, has none. */
export const ENGLISH_PREFIX = "/en";

/**
 * The public pages (#470, #544, #545): the home page, Nouveautés, Légal, Aide, the sign-in pages, the Job Digest
 * unsubscribe page and the page shown once an account is deleted. Each is served in English under `/en`, with the
 * same French slugs, and their URL's `lang` chooses their language.
 */
const PUBLIC_PAGE = /^\/(?:(?:desabonnement|nouveautes|legal|aide|connexion|compte\/supprime)(?:\/|$)|$)/;

/** Whether `pathname` (without `/en`) is a public page. */
export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGE.test(pathname);
}

/**
 * `pathname` without its `/en` prefix, and the language that prefix names: `/en/legal/cgu` is `/legal/cgu` in
 * English, `/en` the home page; any other path is French.
 */
export function splitLocalePrefix(pathname: string): { locale: Locale; pathname: string } {
  if (pathname === ENGLISH_PREFIX || pathname.startsWith(`${ENGLISH_PREFIX}/`)) return { locale: "en", pathname: pathname.slice(ENGLISH_PREFIX.length) || "/" };
  return { locale: "fr", pathname };
}

/**
 * What the URL chooses on `pathname` (as asked, `/en` included) with its `lang`:
 * - `rewrite`: the page to serve, for a public page under `/en`;
 * - `chosen`: the page's language whoever reads it, from `lang` on a public page;
 * - `visitor`: a Visitor's language, from `/en` on a public page, or from `lang` elsewhere;
 * - `url`: the language of the URL itself: on a public page, French without `/en` or `lang`; elsewhere, only the one
 *   `/en` or `lang` names. `/en` before a page that is not public serves nothing (404), in English for a Visitor.
 */
export function urlLocale(pathname: string, lang: string | null): { rewrite?: string; chosen?: Locale; visitor?: Locale; url?: Locale } {
  const prefixed = splitLocalePrefix(pathname);
  const asked = isSupportedLocale(lang) ? lang : undefined;
  if (!isPublicPage(prefixed.pathname)) {
    const visitor = asked ?? (prefixed.pathname === pathname ? undefined : prefixed.locale);
    return visitor ? { visitor, url: visitor } : {};
  }
  const rewrite = prefixed.pathname === pathname ? {} : { rewrite: prefixed.pathname, visitor: prefixed.locale };
  return { ...rewrite, ...(asked ? { chosen: asked } : {}), url: asked ?? prefixed.locale };
}
