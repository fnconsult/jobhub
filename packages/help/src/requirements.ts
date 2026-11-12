/**
 * Which Help Articles are served under the Platform Settings in force (#867, ADR-0107): an article that `requires`
 * « Espace coach v2 » only while it is on, in place of the article of the same id written without it (its `<id>.v2.md`
 * replaces `<id>.md`); while it is off, exactly the articles written without a requirement. Pure: the build, the Help
 * Centre, its search and sitemap, the Coach Panel and the Back Office read the same.
 *
 *   servedArticles(all, { coachSpaceV2: false }); // the articles main served
 *   servedArticles(all, { coachSpaceV2: true });  // the epic's: the added ones, and each `.v2` in its base's place
 */
import type { HelpArticle, HelpArticleRequirement } from "./types";

/** The Platform Settings a Help Article may wait for, as the reader's request has them; each off unless said. */
export interface HelpSettings {
  /** « Espace coach v2 » (`COACH_SPACE_V2`) is on. */
  coachSpaceV2?: boolean;
}

/** Both states of every setting, off first: what the build and the tests check the articles in. */
export const HELP_SETTINGS_STATES: readonly Required<HelpSettings>[] = [{ coachSpaceV2: false }, { coachSpaceV2: true }];

function met(requirement: HelpArticleRequirement, settings: HelpSettings): boolean {
  return requirement === "coach-space-v2" && settings.coachSpaceV2 === true;
}

/** The articles of `all` served under `settings`, in `all`'s order: one per id at most. */
export function servedArticles(all: readonly HelpArticle[], settings: HelpSettings = {}): HelpArticle[] {
  const replaced = new Set(all.filter((article) => article.requires && met(article.requires, settings)).map((article) => article.id));
  return all.filter((article) => (article.requires ? met(article.requires, settings) : !replaced.has(article.id)));
}
