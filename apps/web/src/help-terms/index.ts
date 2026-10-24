/**
 * Help in pages, with no chrome (#343, ADR-0035): the glossary terms whose first mention on a page opens their Help
 * Article in the Coach Panel, and the empty states that link to theirs. No AI here: only which article, and which mention.
 *
 *   HELP_TERMS.matchScore                         // "glossary-match-score"
 *   EMPTY_STATE_HELP.proposals                    // "glossary-proposals"
 *   mentions.isFirst(pathname, "matchScore", id)  // true for the page's first mention only
 *   termsWithin("Votre quota se renouvelle…", { planQuota: "quota" }) // ["Votre ", { term: "planQuota", words: "quota" }, " se renouvelle…"]
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

/** A piece of a sentence: plain text, or the words that name a term. */
export type SentencePiece = string | { term: HelpTermName; words: string };

/**
 * `text` cut into its pieces: each term's words at their first occurrence, whatever their case (kept as `text` has
 * them), and the plain text around them, in order. A term whose words are not in `text` (a language that words the
 * sentence otherwise), or overlap a term's named earlier in it, is left out.
 */
export function termsWithin(text: string, terms: Partial<Record<HelpTermName, string>>): SentencePiece[] {
  const folded = text.toLocaleLowerCase();
  const found = (Object.entries(terms) as [HelpTermName, string][])
    .filter(([, words]) => words.length > 0)
    .map(([term, words]) => ({ term, at: folded.indexOf(words.toLocaleLowerCase()), length: words.length }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at);
  const pieces: SentencePiece[] = [];
  let from = 0;
  for (const { term, at, length } of found) {
    if (at < from) continue;
    if (at > from) pieces.push(text.slice(from, at));
    pieces.push({ term, words: text.slice(at, at + length) });
    from = at + length;
  }
  if (from < text.length || pieces.length === 0) pieces.push(text.slice(from));
  return pieces;
}
