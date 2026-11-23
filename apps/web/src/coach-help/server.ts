import { articlesFor, type HelpArticle, type HelpLocale, type HelpSettings } from "@jobhub/help";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { exchangesOn } from "@/exchanges/server";

/**
 * The Help Articles' settings for this request (#867, ADR-0107): « Espace coach v2 » on or off, and the Applications'
 * Exchanges (#1099, APPLICATION_EXCHANGES_ENABLED), whose articles are served only while they are on. Off, every reader on the
 * server (the Help Centre, its search and sitemap, the AI Coach) gets the articles main served; on, the epic's.
 */
export function helpSettings(): HelpSettings {
  return { coachSpaceV2: coachSpaceV2On(), applicationExchanges: exchangesOn() };
}

/** The Help Articles served in `locale` for this request: what every server reader passes as `from`. */
export function servedHelpArticles(locale: HelpLocale): readonly HelpArticle[] {
  return articlesFor(locale, helpSettings());
}
