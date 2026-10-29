/**
 * The fixed rules of the « Contenu piégé dans un email » Guardrail and of Email intake's reading (#446, ADR-0052).
 * Used by `guardEmail` (./index); exported for the inbound route, which marks the email's hidden text.
 *
 * On input, before any AI reads the email: an unauthenticated sender, a text over MAX_GUARDED_EMAIL_CHARACTERS,
 * hidden text carrying instructions (text the email hides from its reader, marked by the inbound route between
 * HIDDEN_TEXT_OPEN and HIDDEN_TEXT_CLOSE, or written in invisible Unicode tag characters), and known injection patterns.
 * On output, always on whatever the Guardrail's setting: no email address, phone number or person's name from the email
 * in the reading, every offer's link present as is in the email, at most MAX_EMAIL_OFFERS offers.
 */
import { identityIn, personNamesIn, type OfferEmailReading } from "@jobhub/ai";

/** Where the inbound route marks the text an email hides from its reader (display:none, zero size, invisible colour…). */
export const HIDDEN_TEXT_OPEN = "⟦texte masqué⟧";
export const HIDDEN_TEXT_CLOSE = "⟦/texte masqué⟧";

/** Longer than this, an email is not read: an alert of 30 offers fits several times over. */
export const MAX_GUARDED_EMAIL_CHARACTERS = 40_000;

/** The most offers one reading may give. */
export const MAX_EMAIL_OFFERS = 30;

/** Which fixed rule caught an email on input. */
export type EmailInputRule = "unauthenticated_sender" | "too_large" | "hidden_instructions" | "injection_pattern";

/** Which fixed rule set a reading aside. */
export type ReadingRule = "contact" | "person_name" | "link_not_in_email" | "too_many_offers";

/** The email as the Guardrail reads it. */
export interface GuardedEmail {
  /** Its text, as Email intake keeps it: the hidden parts marked. */
  text: string;
  /** Whether its sender was authenticated on arrival (DMARC, or aligned DKIM or SPF): a Recognised sender or the Candidate's own address. */
  authenticated: boolean;
}

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'")
    .toLowerCase();

/** Known prompt injection patterns, matched without accents nor case. */
const INJECTION_PATTERNS = [
  /\bignor(?:e|ez|er)\b.{0,30}\b(?:instructions?|consignes?|regles?|directives?)\b/,
  /\b(?:oublie|oubliez|oublier)\b.{0,30}\b(?:instructions?|consignes?|regles?|directives?)\b/,
  /\b(?:ignore|disregard|forget|override)\b.{0,30}\b(?:instructions?|rules?|prompt|guidelines?)\b/,
  /\b(?:system prompt|prompt (?:systeme|system)|developer mode|mode developpeur|jailbreak)\b/,
  /\b(?:tu es|vous etes) (?:maintenant|desormais|a present)\b/,
  /\byou are now\b/,
  /\bnouvelles? (?:instructions?|consignes?)\s*:/,
  /\bnew instructions?\s*:/,
  /\b(?:note|message|instructions?|consignes?) (?:pour|a|au|aux|destinee?s? a) (?:l'ia|l'assistant|l'agent|le modele|le robot|l'intelligence artificielle|ai|llm)\b/,
  /\b(?:note|message|instructions?) (?:to|for) (?:the )?(?:ai|assistant|model|llm|agent)\b/,
  /\bsi (?:tu es|vous etes) (?:une? )?(?:ia|intelligence artificielle|assistant|modele|robot|llm)\b/,
  /\bif you are an? (?:ai|assistant|language model|llm|bot)\b/,
  /<\|im_start\|>|\[\/?inst\]|<<sys>>|^#{2,}\s*(?:system|instructions?)\b/m,
  /^\s*(?:system|assistant)\s*:/m,
];

/** Instruction words that have nothing to do in text hidden from the email's reader. */
const INSTRUCTION_WORDS =
  /\b(?:ajoute|ajoutez|ajouter|ignore|ignorez|ignorer|oublie|oubliez|inclus|incluez|inclure|insere|inserez|remplace|remplacez|recopie|recopiez|considere|considerez|add|include|insert|replace|disregard|override|pretend|instructions?|consignes?|prompt|l'ia|llm)\b/;

/** Unicode tag characters (U+E0000–U+E007F): text no one sees, that a model may read. */
const TAG_CHARACTERS = /[\u{E0000}-\u{E007F}]/u;

/** The parts of `text` its email hides from its reader. */
function hiddenParts(text: string): string[] {
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(HIDDEN_TEXT_OPEN, from);
    if (start < 0) return parts;
    const end = text.indexOf(HIDDEN_TEXT_CLOSE, start);
    parts.push(text.slice(start + HIDDEN_TEXT_OPEN.length, end < 0 ? undefined : end));
    if (end < 0) return parts;
    from = end + HIDDEN_TEXT_CLOSE.length;
  }
}

/** The first fixed rule an email breaks on input, before any AI reads it; null when none. */
export function emailInputRule(email: GuardedEmail): EmailInputRule | null {
  if (!email.authenticated) return "unauthenticated_sender";
  if (email.text.length > MAX_GUARDED_EMAIL_CHARACTERS) return "too_large";
  if (TAG_CHARACTERS.test(email.text) || hiddenParts(email.text).some((part) => INSTRUCTION_WORDS.test(plain(part)))) return "hidden_instructions";
  const text = plain(email.text);
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(text))) return "injection_pattern";
  return null;
}

/** An offer's words the reading wrote, its link aside. */
const wordsOf = (reading: OfferEmailReading) =>
  reading.offers.flatMap((offer) => [offer.title, offer.employer, offer.intermediary, offer.location, offer.contract, offer.salary, offer.excerpt]).filter((value): value is string => Boolean(value));

/**
 * The people the email names, as `personNamesIn` finds them, but for the employers, intermediaries and places the
 * reading gives that are named after a person (« Pierre Fabre », « Mr Bricolage », « rue Jean Jaurès »): the name
 * shape alone cannot tell them apart. A name the email also gives an address to (« claire.martin@… », « c.martin@… »)
 * is a contact's, wherever the reading writes it.
 */
function peopleNamedIn(emailText: string, reading: OfferEmailReading): string[] {
  const organisationsAndPlaces = reading.offers.flatMap((offer) => [offer.employer, offer.intermediary, offer.location]).filter((value): value is string => Boolean(value)).map(plain);
  const addressWords = identityIn(emailText).emails.map((address) => plain(address.split("@")[0] ?? "").split(/[^a-z0-9]+/));
  const surname = (name: string) => plain(name).split(/[\s-]+/).at(-1) ?? "";
  const isContact = (name: string) => addressWords.some((words) => words.includes(surname(name)));
  return personNamesIn(emailText).filter((name) => isContact(name) || !organisationsAndPlaces.some((given) => given.includes(plain(name))));
}

/** The first fixed rule a reading breaks, against the email it read; null when none. Always on. */
export function readingRule(reading: OfferEmailReading, emailText: string): ReadingRule | null {
  if (reading.offers.length > MAX_EMAIL_OFFERS) return "too_many_offers";
  const written = wordsOf(reading).join("\n");
  const found = identityIn(written);
  if (found.emails.length > 0 || found.phones.length > 0) return "contact";
  const named = plain(written);
  if (peopleNamedIn(emailText, reading).some((name) => named.includes(plain(name)))) return "person_name";
  if (reading.offers.some((offer) => offer.link !== undefined && !emailText.includes(offer.link))) return "link_not_in_email";
  return null;
}
