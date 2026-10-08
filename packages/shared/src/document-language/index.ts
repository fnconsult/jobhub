/**
 * Document Language: the language Tailored Documents are written in. It
 * defaults to the Job Offer's language, independent of the Interface Language.
 */
import type { JobOfferDetails } from "../domain";

export const DOCUMENT_LANGUAGES = ["fr", "en"] as const;
export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

/** Short words that occur in nearly every text of their language and rarely in the other. */
const COMMON_WORDS: Record<DocumentLanguage, ReadonlySet<string>> = {
  fr: new Set(["le", "la", "les", "des", "du", "un", "une", "et", "est", "vous", "nous", "pour", "dans", "avec", "sur", "au", "aux", "de", "en", "votre", "ans", "qui", "que"]),
  en: new Set(["the", "and", "of", "to", "you", "we", "our", "your", "is", "are", "with", "for", "will", "in", "on", "a", "an", "years", "who", "have", "be"]),
};

/**
 * The language a Job Offer is written in, from its title and text. A posting
 * that says too little to tell is taken as French: Jobbbox serves the French market.
 */
export function jobOfferLanguage(jobOffer: Pick<JobOfferDetails, "title" | "content">): DocumentLanguage {
  const words = `${jobOffer.title} ${jobOffer.content}`.toLowerCase().split(/[^\p{L}]+/u);
  const count = (language: DocumentLanguage) => words.filter((word) => COMMON_WORDS[language].has(word)).length;
  return count("en") > count("fr") ? "en" : "fr";
}
