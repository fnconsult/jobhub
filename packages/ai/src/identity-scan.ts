/**
 * The AI layer's safety net for identity routing (ADR-0007 amendment): finds a phone number or an
 * email address in prompt text a call site did not declare as carrying the Candidate's identity. The
 * same shapes are what redaction always removes before a call (redaction.ts).
 * Names and postal addresses cannot be told apart from other text, so call sites must still declare.
 *
 * Prompts often carry job-offer text, full of long digit runs (dates, salary ranges, references,
 * SIREN/SIRET numbers). A hit reroutes the call and is logged, so only phone-number shapes count,
 * never "any run of digits".
 */

export type IdentityHit = "phone" | "email";

// Starts only where a run of address characters starts, so a long run with no "@" (a capped log text,
// a base64 blob) is read once, not once per character.
const EMAIL = /(?<![^\s@<>()[\]",;:])[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[a-z]{2,}/i;
const EMAILS = new RegExp(EMAIL.source, "gi");

// Never the tail of a longer number ("552 100 554 00013", "1 004 567 890").
const NOT_AFTER_A_NUMBER = String.raw`(?<!\d[\s.,-]?)`;

/**
 * International: "+" or "00", a country code, then digit groups split by one space, dot or dash,
 * with an optional "(0)" trunk prefix or bracketed area code: "+33 (0)6 12 34 56 78", "+1 (415) 555-0132".
 */
const INTERNATIONAL = new RegExp(
  String.raw`${NOT_AFTER_A_NUMBER}(?<![\w+])(?:\+|\b00(?=[1-9]))\d+(?:[ .-]?\(\d+\)\d*|[ .-]\d+)*(?!\d)`,
  "g",
);
const INTERNATIONAL_DIGITS = { min: 8, max: 15 }; // E.164 caps a number at 15 digits
// "+30 000 000 visiteurs": a rounded quantity, written in thousands, is not a phone number.
const ROUNDED_QUANTITY = /[ .]000$/;

/**
 * National: a leading 0 and 10 digits in groups of 2 to 4, split by the same separator throughout:
 * "06 12 34 56 78", "06.12.34.56.78", "0612345678", "079 123 45 67".
 */
const NATIONAL = new RegExp(String.raw`${NOT_AFTER_A_NUMBER}\b0\d{1,3}([ .-]?)\d{2,4}(?:\1\d{2,4}){1,3}(?!\d)`, "g");
const NATIONAL_DIGITS = 10;

const digitCount = (text: string) => text.replace(/\D/g, "").length;

/** Where a phone number or email address is in a text: its first character and the one after it. */
export interface IdentityMatch {
  kind: IdentityHit;
  start: number;
  end: number;
  text: string;
}

/** Every phone number in a text, by the shapes above (an international one first where both match). */
export function findPhones(text: string): IdentityMatch[] {
  const found: IdentityMatch[] = [];
  for (const match of text.matchAll(INTERNATIONAL)) {
    const digits = digitCount(match[0]);
    if (digits >= INTERNATIONAL_DIGITS.min && digits <= INTERNATIONAL_DIGITS.max && !ROUNDED_QUANTITY.test(match[0])) {
      found.push({ kind: "phone", start: match.index, end: match.index + match[0].length, text: match[0] });
    }
  }
  for (const match of text.matchAll(NATIONAL)) {
    if (digitCount(match[0]) === NATIONAL_DIGITS) found.push({ kind: "phone", start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return found;
}

/** Every email address in a text. */
export function findEmails(text: string): IdentityMatch[] {
  return [...text.matchAll(EMAILS)].map((match) => ({ kind: "email" as const, start: match.index, end: match.index + match[0].length, text: match[0] }));
}

const hasPhone = (text: string): boolean => findPhones(text).length > 0;

/** What kinds of identity the texts show, in a fixed order; empty when none. */
export function findIdentity(texts: readonly string[]): IdentityHit[] {
  const hits: IdentityHit[] = [];
  if (texts.some(hasPhone)) hits.push("phone");
  if (texts.some((text) => EMAIL.test(text))) hits.push("email");
  return hits;
}
