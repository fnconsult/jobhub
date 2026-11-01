/** The Interface Languages every Help Article is written in. */
export const HELP_LOCALES = ["fr", "en"] as const;
export type HelpLocale = (typeof HELP_LOCALES)[number];

/**
 * What a Help Article explains: one page (« Sur cette page »), one term of the glossary, one frequent question, or one
 * task step by step (a Tutorial: numbered steps in text, the interface's labels word for word, no image, ADR-0065).
 */
export const HELP_ARTICLE_KINDS = ["page", "glossary", "faq", "tutorial"] as const;
export type HelpArticleKind = (typeof HELP_ARTICLE_KINDS)[number];

/**
 * Who a Help Article is written for (ADR-0065). An `administrator` article is never public: absent from the Help Centre,
 * its search and `sitemap.xml`; it is read in the Back Office only (#551).
 */
export const HELP_AUDIENCES = ["visitor", "guest", "candidate", "human-coach", "administrator"] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];

/**
 * The Help Centre's topics (« rubriques », #501), in the order /aide shows them, each named by a task: « Découvrir
 * Jobbbox », « L'extension », « Utiliser Jobbbox », « Espace coach ». An Administrator article's topic is free (a
 * Back Office section, #551), never one of these.
 */
export const PUBLIC_HELP_TOPICS = ["decouvrir", "extension", "utiliser", "espace-coach"] as const;
export type PublicHelpTopic = (typeof PUBLIC_HELP_TOPICS)[number];

/** A Help Article in one language: drafted by an agent or a person, never served before a person reviewed and merged it (ADR-0065). */
export interface HelpArticle {
  /** The same in both languages: the article's file name. */
  id: string;
  locale: HelpLocale;
  kind: HelpArticleKind;
  /** Who it is written for; the same in both languages. */
  audience: HelpAudience;
  /** Its topic: one of PUBLIC_HELP_TOPICS for a public article, a free slug for an Administrator's; the same in both languages. */
  topic: string;
  title: string;
  /** Words a reader may use that should find this article. */
  synonyms: string[];
  /** For a `page` article, the app route pattern it explains (`/candidatures/[id]`); null otherwise. */
  route: string | null;
  /** Short Markdown, no images. */
  body: string;
}
