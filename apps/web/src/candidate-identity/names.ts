/**
 * The rules of a Candidate's names (#918): their Given Name and Family Name, which the account's `name` is made of
 * (« Prénom Nom »), and how both are worked out of a full name the first time (the account's name, else the latest
 * Master CV's), the way `givenNameOf` (@jobhub/ai) tells a first name from a family name.
 */

/** The longest Given Name, Family Name or Preferred Name the Candidate may enter. */
export const IDENTITY_NAME_MAX_LENGTH = 80;

/** A name as kept: trimmed, its runs of white space made one space. */
export function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The account's name: « Prénom Nom », the one of them there is, or empty. */
export function fullNameOf(names: { givenName: string | null; familyName: string | null }): string {
  return [names.givenName, names.familyName].map((name) => cleanName(name ?? "")).filter(Boolean).join(" ");
}

/** A word all in capitals (two letters at least): how French CVs write a family name. */
const inCapitals = (word: string) => word === word.toUpperCase() && word !== word.toLowerCase() && word.replace(/[^\p{L}]/gu, "").length >= 2;

/** A word in capitals written as a name (« DUPONT-MOREL » → « Dupont-Morel », « D'ARCY » → « D'Arcy »); any other word as it is. */
function asName(word: string): string {
  if (!inCapitals(word)) return word;
  return word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toUpperCase());
}

/**
 * The Given Name and Family Name in a full name: the words in capitals are the family name when others are not
 * (« DUPONT Marie » → Marie, Dupont); otherwise the first word is the Given Name and the rest the Family Name. Words in
 * capitals are written as names.
 */
export function namesFromFullName(fullName: string): { givenName: string; familyName: string } {
  const words = cleanName(fullName).split(" ").filter(Boolean);
  const capitals = words.filter(inCapitals);
  const [given, family] =
    capitals.length > 0 && capitals.length < words.length ? [words.filter((word) => !inCapitals(word)), capitals] : [words.slice(0, 1), words.slice(1)];
  return { givenName: given.map(asName).join(" "), familyName: family.map(asName).join(" ") };
}

/** The name the Sidebar calls the Candidate by (#923): their Preferred Name, else their Given Name; null with neither. */
export function calledName(names: { givenName: string | null; preferredName: string | null }): string | null {
  return cleanName(names.preferredName ?? "") || cleanName(names.givenName ?? "") || null;
}

/** The particles a family name may start with, which its initial skips (« de La Rochefoucauld » → R, « d'Arcy » → A). */
const PARTICLES = /^(?:(?:de|du|des)\s+(?:la\s+|l['’])?|d['’])/i;

/** A name's first letter, in capitals; empty for none. */
const initial = (name: string) => cleanName(name).match(/\p{L}/u)?.[0]?.toUpperCase() ?? "";

/**
 * The Candidate's initials (#923), the Sidebar's stand-in for their photo: their Given Name's first letter and their
 * Family Name's, its particles skipped (« Marie de La Rochefoucauld » → MR); the one there is; null with neither.
 */
export function initialsOf(names: { givenName: string | null; familyName: string | null }): string | null {
  const letters = initial(names.givenName ?? "") + initial(cleanName(names.familyName ?? "").replace(PARTICLES, ""));
  return letters || null;
}
