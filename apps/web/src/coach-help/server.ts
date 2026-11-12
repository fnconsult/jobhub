import { articlesFor, type HelpArticle, type HelpLocale, type HelpSettings } from "@jobhub/help";
import { coachSpaceV2On } from "@/coach-space-v2/server";

/**
 * The Help Articles' settings for this request (#867, ADR-0107): « Espace coach v2 » on or off. Off, every reader on the
 * server (the Help Centre, its search and sitemap, the AI Coach) gets the articles main served; on, the epic's.
 */
export function helpSettings(): HelpSettings {
  return { coachSpaceV2: coachSpaceV2On() };
}

/** The Help Articles served in `locale` for this request: what every server reader passes as `from`. */
export function servedHelpArticles(locale: HelpLocale): readonly HelpArticle[] {
  return articlesFor(locale, helpSettings());
}
