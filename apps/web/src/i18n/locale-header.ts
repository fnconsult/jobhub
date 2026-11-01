import { isSupportedLocale, type Locale } from "@jobhub/shared/i18n";

/**
 * Request header naming the Interface Language a page is shown in, when the URL
 * chooses it rather than the signed-in Candidate (the Job Digest unsubscribe
 * page, opened from an email in the Candidate's language; the public pages and
 * their FR/EN switch, #544). Set only by `src/proxy.ts`, which overwrites any
 * value a client sent.
 */
export const LOCALE_HEADER = "x-jobhub-locale";

/**
 * Request header naming the language a Visitor chose with the URL's `lang` on any other page (an error page under the
 * public site's header, #544): it applies only when no Candidate is signed in. Set only by `src/proxy.ts`.
 */
export const VISITOR_LOCALE_HEADER = "x-jobhub-visitor-locale";

/**
 * Pages whose language is chosen by their URL's `lang`: routes.jobDigestUnsubscribe, and the public pages (#470,
 * #544): Nouveautés, Légal, Aide, the sign-in pages and the page shown once an account is deleted.
 */
const LANG_IN_URL = /^\/(desabonnement|nouveautes|legal|aide|connexion|compte\/supprime)(\/|$)/;

/** What the URL's `lang` chooses on `pathname`: the page's language (`chosen`), a Visitor's (`visitor`), or nothing. */
export function urlLocale(pathname: string, lang: string | null): { chosen?: Locale; visitor?: Locale } {
  if (!isSupportedLocale(lang)) return {};
  return LANG_IN_URL.test(pathname) ? { chosen: lang } : { visitor: lang };
}

/**
 * The Help Centre in English (#549): `/en/aide`, `/en/aide/<topic>` and `/en/aide/<topic>/<article>` serve the French
 * address's page in English. The French path for such a `pathname`, or null for any other. The `/en` prefix of the
 * whole public site is #545's.
 */
export function englishHelpCentrePath(pathname: string): string | null {
  const english = /^\/en(\/aide(?:\/.*)?)$/.exec(pathname);
  return english ? english[1]! : null;
}
