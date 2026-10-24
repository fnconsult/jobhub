/**
 * Help in pages, with no chrome (#343, ADR-0035): the glossary terms whose first mention on a page opens their Help
 * Article in the Coach Panel, and the empty states that link to theirs. No AI here: only which article, and which mention.
 *
 *   HELP_TERMS.matchScore                         // "glossary-match-score"
 *   EMPTY_STATE_HELP.proposals                    // "glossary-proposals"
 *   mentions.isFirst(pathname, "matchScore", id)  // true for the page's first mention only
 *   wordsWithin("Votre quota se renouvelle…", "quota") // ["Votre ", "quota", " se renouvelle…"]
 */

/** The glossary terms a page can explain, and the glossary entry each one opens. */
export const HELP_TERMS = {
  matchScore: "glossary-match-score",
  atsScore: "glossary-ats-score",
  proposals: "glossary-proposals",
  masterCv: "glossary-master-cv",
  tailoredCv: "glossary-tailored-cv",
  followUp: "glossary-follow-up",
  planQuota: "glossary-plan-quota",
} as const;
export type HelpTermName = keyof typeof HELP_TERMS;

/** The empty states with a help link, and the Help Article each one opens. */
export const EMPTY_STATE_HELP = {
  proposals: "glossary-proposals",
  followUps: "glossary-follow-up",
  applications: "page-applications",
  jobSearches: "glossary-job-search",
  agenda: "page-agenda",
  profiles: "page-new-profile",
} as const;
export type EmptyStateName = keyof typeof EMPTY_STATE_HELP;

/**
 * Which mention of a term is the page's first, as the page is shown: the first one asked about, until it leaves the
 * page. A mention is any key that stays the same while it is shown (a React id). A new page starts afresh.
 */
export interface Mentions {
  /** Whether `mention` is the first mention of `term` on `page` (a pathname); the first asked about becomes it. */
  isFirst(page: string, term: HelpTermName, mention: string): boolean;
  /** `mention` has left the page: the next mention of `term` shown can become the first. */
  forget(term: HelpTermName, mention: string): void;
}

export function createMentions(): Mentions {
  let shown: string | null = null;
  const first = new Map<HelpTermName, string>();
  return {
    isFirst(page, term, mention) {
      if (page !== shown) {
        shown = page;
        first.clear();
      }
      const claimed = first.get(term);
      if (claimed === undefined) first.set(term, mention);
      return (claimed ?? mention) === mention;
    },
    forget(term, mention) {
      if (first.get(term) === mention) first.delete(term);
    },
  };
}

/**
 * `text` split around the first occurrence of `words`, whatever their case: [before, the words as `text` has them,
 * after]. The whole text is the words when they are not in it (a language that words the sentence otherwise).
 */
export function wordsWithin(text: string, words: string): [string, string, string] {
  const at = text.toLocaleLowerCase().indexOf(words.toLocaleLowerCase());
  if (at < 0 || words.length === 0) return ["", text, ""];
  return [text.slice(0, at), text.slice(at, at + words.length), text.slice(at + words.length)];
}
