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
