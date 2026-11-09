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

/**
 * The Candidate's formal name (#922): « Prénom Nom », for the Withdrawal form and any formal document; with neither
 * entered, the account's name (a Sign-in Provider's, for an account made since #918, say); else empty.
 */
export function formalNameOf(names: { givenName: string | null; familyName: string | null; name: string | null }): string {
  return fullNameOf(names) || cleanName(names.name ?? "");
}

/** The Candidate as a Human Coach names them (#922): their name, and the Preferred Name to call them by when it is not their Given Name. */
export interface NameForCoach {
  /** « Marie Dupont » (« Marie D. » in the short form); empty when the Candidate gave no name. */
  name: string;
  /** « Mimi »: the Preferred Name when it differs from the Given Name; null otherwise. */
  calledBy: string | null;
}

/** The first letter of a name, in capitals: « dupont » → « D ». */
const initialOf = (name: string) => (Array.from(name)[0] ?? "").toLocaleUpperCase("fr");

/**
 * How a Human Coach sees the Candidate (#922): « Prénom Nom » in full (the Espace coach's Candidates, a Candidate's
 * page), or the Given Name and the Family Name's initial in the short form (« Marie D. »: a Coaching Session, which
 * needs no Coach Access); with neither name entered, the account's name (a Sign-in Provider's, say) gives them. Beside
 * it, the Preferred Name when it differs from the Given Name (« se fait appeler Mimi »).
 */
export function nameForCoach(
  names: { givenName: string | null; familyName: string | null; preferredName: string | null; name: string | null },
  form: "full" | "short" = "full",
): NameForCoach {
  const given = cleanName(names.givenName ?? "");
  const family = cleanName(names.familyName ?? "");
  const preferred = cleanName(names.preferredName ?? "");
  const calledBy = preferred && preferred.toLocaleLowerCase("fr") !== given.toLocaleLowerCase("fr") ? preferred : null;
  if (form === "full") return { name: formalNameOf(names), calledBy };
  if (!given && !family) {
    const words = cleanName(names.name ?? "").split(" ").filter(Boolean);
    return { name: words.length < 2 ? (words[0] ?? "") : `${words[0]} ${initialOf(words.at(-1)!)}.`, calledBy };
  }
  return { name: given ? (family ? `${given} ${initialOf(family)}.` : given) : `${initialOf(family)}.`, calledBy };
}
