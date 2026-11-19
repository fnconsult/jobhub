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
 * The words of `text`, lower-cased, that can tell its language: a token glued to a figure (a reference « 4a7k2m », a
 * model « A350 », « S4/HANA », « 3a ») is no word, or its letters would read « a » or « in » as English (#1078).
 */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "" && !/\p{N}/u.test(token));
}

/**
 * The language a Job Offer is written in, from its title and text. A posting
 * that says too little to tell is taken as French: Jobbbox serves the French market.
 */
export function jobOfferLanguage(jobOffer: Pick<JobOfferDetails, "title" | "content">): DocumentLanguage {
  const words = wordsOf(`${jobOffer.title} ${jobOffer.content}`);
  const count = (language: DocumentLanguage) => words.filter((word) => COMMON_WORDS[language].has(word)).length;
  return count("en") > count("fr") ? "en" : "fr";
}

/**
 * Words a CV writes in one language only: month names, « aujourd'hui », language levels. They tell the
 * language of a text too short for common words: a job's period, a language's level.
 */
const CV_WORDS: Record<DocumentLanguage, ReadonlySet<string>> = {
  fr: new Set([
    "janvier", "février", "fevrier", "mars", "avril", "mai", "juin", "juillet", "août", "aout", "septembre", "octobre", "novembre", "décembre", "decembre",
    "janv", "févr", "fevr", "avr", "juil", "déc", "aujourd", "hui", "présent", "depuis", "actuellement", "courant", "maternelle", "langue", "bilingue", "notions", "anglais", "français", "allemand", "espagnol", "italien",
  ]),
  en: new Set([
    "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "dec", "present", "since", "current", "fluent", "native", "basic", "english", "french", "german", "spanish", "italian",
  ]),
};

/**
 * The language a text of a document is written in, from its common words and the words of a CV;
 * null when it says too little to tell (a proper noun, a figure, a word both languages share).
 * A cheap check that nothing is left in another language than the Document Language.
 */
export function textLanguage(text: string): DocumentLanguage | null {
  const words = wordsOf(text);
  const count = (language: DocumentLanguage) => words.filter((word) => COMMON_WORDS[language].has(word) || CV_WORDS[language].has(word)).length;
  const fr = count("fr");
  const en = count("en");
  if (fr === en) return null;
  return fr > en ? "fr" : "en";
}

/** Month names and words of a period, from French into English: « janv. 2005 – aujourd'hui » → « Jan. 2005 – present ». */
const PERIOD_WORDS_FR_EN: readonly (readonly [RegExp, string])[] = [
  [/\baujourd['’]hui\b/giu, "present"],
  [/\bà ce jour\b/giu, "present"],
  [/(?<![\p{L}])(présent|actuellement)(?![\p{L}])/giu, "present"],
  [/(?<![\p{L}])depuis(?![\p{L}])/giu, "since"],
  [/(?<![\p{L}])janvier(?![\p{L}])/giu, "January"],
  [/(?<![\p{L}])f[ée]vrier(?![\p{L}])/giu, "February"],
  [/(?<![\p{L}])mars(?![\p{L}])/giu, "March"],
  [/(?<![\p{L}])avril(?![\p{L}])/giu, "April"],
  [/(?<![\p{L}])mai(?![\p{L}])/giu, "May"],
  [/(?<![\p{L}])juin(?![\p{L}])/giu, "June"],
  [/(?<![\p{L}])juillet(?![\p{L}])/giu, "July"],
  [/(?<![\p{L}])ao[ûu]t(?![\p{L}])/giu, "August"],
  [/(?<![\p{L}])septembre(?![\p{L}])/giu, "September"],
  [/(?<![\p{L}])octobre(?![\p{L}])/giu, "October"],
  [/(?<![\p{L}])novembre(?![\p{L}])/giu, "November"],
  [/(?<![\p{L}])d[ée]cembre(?![\p{L}])/giu, "December"],
  [/(?<![\p{L}])janv(?![\p{L}])/giu, "Jan"],
  [/(?<![\p{L}])f[ée]vr?(?![\p{L}])/giu, "Feb"],
  [/(?<![\p{L}])avr(?![\p{L}])/giu, "Apr"],
  [/(?<![\p{L}])juil(?![\p{L}])/giu, "Jul"],
  [/(?<![\p{L}])sept(?![\p{L}])/giu, "Sept"],
  [/(?<![\p{L}])oct(?![\p{L}])/giu, "Oct"],
  [/(?<![\p{L}])nov(?![\p{L}])/giu, "Nov"],
  [/(?<![\p{L}])d[ée]c(?![\p{L}])/giu, "Dec"],
];

/** Month names and words of a period, from English into French: « Jan 2005 – present » → « janv. 2005 – aujourd'hui ». */
const PERIOD_WORDS_EN_FR: readonly (readonly [RegExp, string])[] = [
  [/(?<![\p{L}])(present|now|current|today)(?![\p{L}])/giu, "aujourd'hui"],
  [/(?<![\p{L}])since(?![\p{L}])/giu, "depuis"],
  [/(?<![\p{L}])january(?![\p{L}])/giu, "janvier"],
  [/(?<![\p{L}])february(?![\p{L}])/giu, "février"],
  [/(?<![\p{L}])march(?![\p{L}])/giu, "mars"],
  [/(?<![\p{L}])april(?![\p{L}])/giu, "avril"],
  [/(?<![\p{L}])may(?![\p{L}])/giu, "mai"],
  [/(?<![\p{L}])june(?![\p{L}])/giu, "juin"],
  [/(?<![\p{L}])july(?![\p{L}])/giu, "juillet"],
  [/(?<![\p{L}])august(?![\p{L}])/giu, "août"],
  [/(?<![\p{L}])september(?![\p{L}])/giu, "septembre"],
  [/(?<![\p{L}])october(?![\p{L}])/giu, "octobre"],
  [/(?<![\p{L}])november(?![\p{L}])/giu, "novembre"],
  [/(?<![\p{L}])december(?![\p{L}])/giu, "décembre"],
  [/(?<![\p{L}])jan\.?(?![\p{L}])/giu, "janv."],
  [/(?<![\p{L}])feb\.?(?![\p{L}])/giu, "févr."],
  [/(?<![\p{L}])mar\.?(?![\p{L}])/giu, "mars"],
  [/(?<![\p{L}])apr\.?(?![\p{L}])/giu, "avr."],
  [/(?<![\p{L}])jun\.?(?![\p{L}])/giu, "juin"],
  [/(?<![\p{L}])jul\.?(?![\p{L}])/giu, "juil."],
  [/(?<![\p{L}])aug\.?(?![\p{L}])/giu, "août"],
  [/(?<![\p{L}])sept?\.?(?![\p{L}])/giu, "sept."],
  [/(?<![\p{L}])oct\.?(?![\p{L}])/giu, "oct."],
  [/(?<![\p{L}])nov\.?(?![\p{L}])/giu, "nov."],
  [/(?<![\p{L}])dec\.?(?![\p{L}])/giu, "déc."],
];

/**
 * A job's period as written on a CV, in `language`: its month names and words (« aujourd'hui », « depuis »)
 * translated, its figures kept as they are. A period with no word, « 2005 – 2024 », is the same in both.
 */
export function periodIn(period: string, language: DocumentLanguage): string {
  const words = language === "en" ? PERIOD_WORDS_FR_EN : PERIOD_WORDS_EN_FR;
  return words.reduce((text, [pattern, word]) => text.replace(pattern, word), period);
}
