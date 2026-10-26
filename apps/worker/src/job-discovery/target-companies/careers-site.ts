/**
 * Telling, from a web search's results, where a Target Company publishes its postings, and which of
 * a company's postings are for the Profile's job (#406).
 *
 *   careersSiteOf("https://job-boards.greenhouse.io/acme/jobs/1", "ACME INDUSTRIE"); // "https://job-boards.greenhouse.io/acme"
 *   careersSiteOf("https://www.acme-industrie.fr/carrieres/daf", "ACME INDUSTRIE");  // "https://www.acme-industrie.fr/carrieres"
 *   isForTheJob("Directrice administrative et financière", ["Directeur financier"]);  // true (same ROME job)
 */
import { atsBoardOf } from "../ats";
import { romeCodesFor } from "../france-travail/rome";

/** Words of a name or title: lower case, no accents, split on anything not a letter or digit. */
const words = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Words that say nothing of which company it is. */
const GENERIC = new Set([
  "sa", "sas", "sasu", "sarl", "eurl", "snc", "sca", "se", "groupe", "group", "france", "industrie", "industries", "services", "service",
  "conseil", "consulting", "logistique", "international", "solutions", "company", "entreprise", "societe", "the", "and", "les", "des", "de", "du", "la", "le", "et",
]);

/** The words of a company's name that tell it apart: 3 letters or more, not a legal form or a common word. */
const telling = (name: string) => words(name).filter((word) => word.length >= 3 && !GENERIC.has(word));

/** Whether `label` (a host name or a board's name, any punctuation) carries the company's name. */
function namesCompany(label: string, company: string): boolean {
  const compact = words(label).join("");
  const own = telling(company);
  return own.length > 0 && own.some((word) => word.length >= 4 && compact.includes(word));
}

/** Path segments a careers page lives under. */
const CAREERS_PATH = /^\/(?:[a-z]{2}\/)?(carrieres?|careers?|jobs|emplois?|recrutement|nous-rejoindre|join-us|offres?-d-emploi)(?=\/|$)/i;

/**
 * The careers site `url` shows for `company`: its board on Greenhouse, Lever or Ashby (a board bearing its name),
 * its page on Welcome to the Jungle, or the careers section of a site bearing its name. Null when `url` is none of these.
 */
export function careersSiteOf(url: string, company: string): string | null {
  if (!URL.canParse(url)) return null;
  const address = new URL(url);
  const board = atsBoardOf(url);
  if (board) return namesCompany(new URL(board).pathname, company) ? board : null;
  const jungle = /^\/([a-z]{2})\/companies\/([^/]+)/.exec(address.pathname);
  if (/(^|\.)welcometothejungle\.com$/i.test(address.hostname) && jungle) {
    return namesCompany(jungle[2]!, company) ? `https://www.welcometothejungle.com/${jungle[1]}/companies/${jungle[2]}/jobs` : null;
  }
  const section = CAREERS_PATH.exec(address.pathname);
  if (address.protocol === "https:" && section && namesCompany(address.hostname, company)) return `${address.origin}${section[0]}`;
  return null;
}

/** Words of a title that do not tell jobs apart. */
const TITLE_FILLERS = new Set(["h", "f", "hf", "fh", "de", "du", "des", "la", "le", "les", "l", "d", "et", "en", "a", "au", "aux", "of", "and", "the", "for", "in"]);

/**
 * Whether a posting titled `title` is for one of the Profile's job `titles`: the same ROME job by Jobbbox's table,
 * or every telling word of one of the titles in it.
 */
export function isForTheJob(title: string, titles: readonly string[]): boolean {
  const codes = new Set(romeCodesFor(title));
  if (titles.some((wanted) => romeCodesFor(wanted).some((code) => codes.has(code)))) return true;
  const own = new Set(words(title));
  return titles.some((wanted) => {
    const needed = words(wanted).filter((word) => !TITLE_FILLERS.has(word));
    return needed.length > 0 && needed.every((word) => own.has(word));
  });
}
