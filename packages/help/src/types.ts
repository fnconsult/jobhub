/** The Interface Languages every Help Article is written in. */
export const HELP_LOCALES = ["fr", "en"] as const;
export type HelpLocale = (typeof HELP_LOCALES)[number];

/** What a Help Article explains: one page (« Sur cette page »), one term of the glossary, or one frequent question. */
export const HELP_ARTICLE_KINDS = ["page", "glossary", "faq"] as const;
export type HelpArticleKind = (typeof HELP_ARTICLE_KINDS)[number];

/** A Help Article in one language: written by the Jobbbox team, never by an AI (ADR-0035). */
export interface HelpArticle {
  /** The same in both languages: the article's file name. */
  id: string;
  locale: HelpLocale;
  kind: HelpArticleKind;
  title: string;
  /** Words a Candidate may use that should find this article. */
  synonyms: string[];
  /** For a `page` article, the app route pattern it explains (`/candidatures/[id]`); null otherwise. */
  route: string | null;
  /** Short Markdown, no images. */
  body: string;
}
