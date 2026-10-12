/**
 * The AI layer's safety net for identity routing (ADR-0007 amendment): finds a phone number or an
 * email address in prompt text a call site did not declare as carrying the Candidate's identity.
 * Names and postal addresses cannot be told apart from other text, so call sites must still declare.
 *
 * Prompts often carry job-offer text, full of long digit runs (dates, salary ranges, references,
 * SIREN/SIRET numbers). A hit reroutes the call and is logged, so only phone-number shapes count,
 * never "any run of digits".
 */

export type IdentityHit = "phone" | "email";

const EMAIL = /[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[a-z]{2,}/i;

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

function hasPhone(text: string): boolean {
  for (const [match] of text.matchAll(INTERNATIONAL)) {
    const digits = digitCount(match);
    if (digits >= INTERNATIONAL_DIGITS.min && digits <= INTERNATIONAL_DIGITS.max && !ROUNDED_QUANTITY.test(match)) return true;
  }
  for (const [match] of text.matchAll(NATIONAL)) {
    if (digitCount(match) === NATIONAL_DIGITS) return true;
  }
  return false;
}

/** What kinds of identity the texts show, in a fixed order; empty when none. */
export function findIdentity(texts: readonly string[]): IdentityHit[] {
  const hits: IdentityHit[] = [];
  if (texts.some(hasPhone)) hits.push("phone");
  if (texts.some((text) => EMAIL.test(text))) hits.push("email");
  return hits;
}
