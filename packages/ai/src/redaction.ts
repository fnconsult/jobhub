/**
 * The guardrail before every AI call (ADR-0007 amendment of 2026-10-20): what names or reaches the
 * Candidate is taken out of the text before it leaves for a provider, generation and web search alike.
 *
 *  - Always, by its shape: every email address and phone number (the shapes of identity-scan.ts).
 *  - When the AI layer knows the Candidate (`CandidateIdentity`): their full name, their last name, their
 *    postal address, email, phone and links, each matched as written, whatever its case and spacing.
 *
 * Each value becomes a placeholder, the same one wherever it appears in the call: « [NOM] » for the full
 * name, « [NOM DE FAMILLE] » for the last name alone, « [ADRESSE] », « [E-MAIL] », « [TÉLÉPHONE] » and
 * « [LIEN] », numbered from the second distinct value of a kind (« [E-MAIL 2] »). `restore` puts back, in
 * a reply, the values this call took out and only those, so a Cover Letter still signs with the name.
 *
 * The first name stays: alone it identifies no one, and the AI Coach addresses the Candidate by it on
 * purpose (ADR-0007, issue #126). Its limits: a name the account and the Master CV do not hold (a new CV's,
 * a referee's) cannot be told apart from other words and goes through; a last name shorter than 3 letters
 * is not matched (too many false hits); and the rest of a CV (employers, dates, career) stays in the text,
 * pseudonymised personal data under GDPR.
 */
import { findEmails, findPhones } from "./identity-scan";

/** What the AI layer knows of the Candidate, to take out of every call made for them. Each may hold several values (the account's and the Master CV's). */
export interface CandidateIdentity {
  fullName?: string | readonly string[];
  /** Kept in the text (see above); it tells the last name apart within a full name. */
  firstName?: string | readonly string[];
  lastName?: string | readonly string[];
  email?: string | readonly string[];
  phone?: string | readonly string[];
  /** A postal address: a bare city, which the career also names, is better left out by the caller. */
  address?: string | readonly string[];
  /** Web addresses: a LinkedIn profile, a personal site. */
  links?: readonly string[];
}

/** What a redaction counts, by kind: never the values. */
export type RedactedKind = "name" | "address" | "email" | "phone" | "link";

type Slot = "fullName" | "lastName" | "address" | "email" | "phone" | "link";

const PLACEHOLDER: Record<Slot, string> = {
  fullName: "NOM",
  lastName: "NOM DE FAMILLE",
  address: "ADRESSE",
  email: "E-MAIL",
  phone: "TÉLÉPHONE",
  link: "LIEN",
};

const KIND: Record<Slot, RedactedKind> = { fullName: "name", lastName: "name", address: "address", email: "email", phone: "phone", link: "link" };

/** A name shorter than this is not matched: "Li" or "Ba" would hit ordinary words. */
const MIN_NAME_LENGTH = 3;
/** An address, email or link shorter than this is not a value worth matching. */
const MIN_VALUE_LENGTH = 5;

/** What a text says to the model when something was taken out of its call, added to its system text. */
export const REDACTION_NOTE =
  "Note : des données personnelles ont été remplacées par des repères entre crochets ([NOM], [E-MAIL]…). Reprends ces repères tels quels là où ces données sont nécessaires, sans les deviner ni les compléter : ils seront remplacés par les vraies valeurs avant que le texte soit utilisé, ce ne sont pas des crochets à compléter.";

export interface Redaction {
  /** The texts as they may be sent, in the order given. */
  texts: string[];
  /** How many values of each kind were taken out; empty when none. */
  counts: Partial<Record<RedactedKind, number>>;
  /** Whether anything was taken out. */
  redacted: boolean;
  /** `text` with each placeholder of this redaction replaced by the value it stands for, as first written. */
  restore(text: string): string;
}

const valuesOf = (value: string | readonly string[] | undefined): string[] =>
  (typeof value === "string" ? [value] : (value ?? [])).map((each) => each.replace(/\s+/g, " ").trim()).filter(Boolean);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `value` as written, whatever its case and spacing, not inside a longer word. */
const literal = (value: string) => new RegExp(String.raw`(?<![\p{L}\p{N}])${value.split(" ").map(escape).join(String.raw`\s+`)}(?![\p{L}\p{N}])`, "giu");

/** A phone number's digits, whatever separates them. */
const phonePattern = (digits: string) => new RegExp(String.raw`(?<!\d)${[...digits].join(String.raw`[\s.\-]?`)}(?!\d)`, "g");

const normal = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const digitsOf = (text: string) => text.replace(/\D/g, "");

interface Matcher {
  slot: Slot;
  pattern: RegExp;
}

/**
 * The first name in a full name: its first word not written in capitals, as French CVs write the family
 * name ("DUPONT Marie" gives "Marie"), else its first word. Empty for an empty name.
 */
export function givenNameOf(fullName: string): string {
  const words = fullName.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words.find((word) => word !== word.toUpperCase()) ?? words[0] ?? "";
}

/**
 * The last names in the full names: what remains once a first name is taken out ("DUPONT Marie" gives
 * "DUPONT"), else all but the first word.
 */
function lastNamesOf(fullNames: string[], firstNames: string[]): string[] {
  const first = new Set(firstNames.map(normal));
  return fullNames.flatMap((fullName) => {
    const words = fullName.split(" ");
    if (words.length < 2) return [];
    const rest = words.filter((word) => !first.has(normal(word)));
    if (rest.length === 0) return [];
    return [(rest.length < words.length ? rest : words.slice(1)).join(" ")];
  });
}

function knownMatchers(identity: CandidateIdentity | null | undefined): Matcher[] {
  if (!identity) return [];
  const fullNames = valuesOf(identity.fullName);
  // Without a first name given, the first full name's (`givenNameOf`).
  const given = valuesOf(identity.firstName);
  const firstNames = given.length > 0 ? given : fullNames.slice(0, 1).map(givenNameOf);
  const named = (slot: Slot, values: string[], min: number): Matcher[] =>
    [...new Set(values.filter((value) => value.length >= min))].map((value) => ({ slot, pattern: literal(value) }));
  return [
    ...named("fullName", fullNames.filter((name) => name.includes(" ")), MIN_NAME_LENGTH),
    ...named("lastName", [...valuesOf(identity.lastName), ...lastNamesOf(fullNames, firstNames)], MIN_NAME_LENGTH),
    ...named("address", valuesOf(identity.address), MIN_VALUE_LENGTH),
    ...named("email", valuesOf(identity.email), MIN_VALUE_LENGTH),
    ...named("link", valuesOf(identity.links), MIN_VALUE_LENGTH),
    ...[...new Set(valuesOf(identity.phone).map(digitsOf))].filter((digits) => digits.length >= 6).map((digits) => ({ slot: "phone" as const, pattern: phonePattern(digits) })),
  ];
}

interface Span {
  slot: Slot;
  start: number;
  end: number;
  text: string;
}

/** What identifies a value whatever its spelling: a phone number's digits, otherwise its words in lower case. */
const keyOf = (slot: Slot, text: string) => `${slot}:${slot === "phone" ? digitsOf(text) : normal(text)}`;

/**
 * `texts` with the Candidate's identity taken out (see above), each value replaced by its placeholder. The
 * texts share one set of placeholders: one value has the same one in the system text and in the messages.
 */
export function redactIdentity(texts: readonly string[], identity?: CandidateIdentity | null): Redaction {
  const matchers = knownMatchers(identity);
  /** Each value taken out, by key: its placeholder and the text it was first written as. */
  const values = new Map<string, { placeholder: string; text: string }>();
  const perBase = new Map<string, number>();
  const counts: Partial<Record<RedactedKind, number>> = {};
  const placeholderOf = (span: Span): string => {
    const key = keyOf(span.slot, span.text);
    const known = values.get(key);
    if (known) return known.placeholder;
    const base = PLACEHOLDER[span.slot];
    const nth = (perBase.get(base) ?? 0) + 1;
    perBase.set(base, nth);
    const placeholder = nth === 1 ? base : `${base} ${nth}`;
    values.set(key, { placeholder, text: span.text });
    return placeholder;
  };

  const redacted = texts.map((text) => {
    const spans: Span[] = [
      ...matchers.flatMap(({ slot, pattern }) => [...text.matchAll(pattern)].map((match) => ({ slot, start: match.index, end: match.index + match[0].length, text: match[0] }))),
      ...findEmails(text).map((match) => ({ ...match, slot: "email" as const })),
      ...findPhones(text).map((match) => ({ ...match, slot: "phone" as const })),
    ];
    // The earliest first, the longest of those: a full name over its last name, an address over the street's name.
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    let out = "";
    let at = 0;
    for (const span of spans) {
      if (span.start < at) continue;
      out += `${text.slice(at, span.start)}[${placeholderOf(span)}]`;
      at = span.end;
      counts[KIND[span.slot]] = (counts[KIND[span.slot]] ?? 0) + 1;
    }
    return out + text.slice(at);
  });

  const byPlaceholder = new Map([...values.values()].map(({ placeholder, text }) => [placeholder.toUpperCase(), text]));
  // The longest first, so "[NOM DE FAMILLE]" is never read as "[NOM]"; a model may change the case or add spaces.
  const placeholders = [...byPlaceholder.keys()].sort((a, b) => b.length - a.length);
  const restorer = placeholders.length > 0 ? new RegExp(String.raw`\[\s*(${placeholders.map((each) => each.split(" ").map(escape).join(String.raw`\s+`)).join("|")})\s*\]`, "giu") : null;
  return {
    texts: redacted,
    counts,
    redacted: values.size > 0,
    restore: (text) => (restorer ? text.replace(restorer, (whole, inner: string) => byPlaceholder.get(inner.replace(/\s+/g, " ").toUpperCase()) ?? whole) : text),
  };
}
