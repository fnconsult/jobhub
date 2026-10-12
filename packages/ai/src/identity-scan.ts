/**
 * The AI layer's safety net for identity routing (ADR-0007 amendment): finds a phone number or an
 * email address in prompt text a call site did not declare as carrying the Candidate's identity.
 * Names and postal addresses cannot be told apart from other text, so call sites must still declare.
 */

export type IdentityHit = "phone" | "email";

const EMAIL = /[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[a-z]{2,}/i;
// Phone-like runs: optional + (or 00), then 9+ digits, single spaces, dots, dashes or brackets between them.
const PHONE = /(?:\+|\b)\d(?:[\s.()-]?\d){8,}/;

/** What kinds of identity the texts show, in a fixed order; empty when none. */
export function findIdentity(texts: readonly string[]): IdentityHit[] {
  const hits: IdentityHit[] = [];
  if (texts.some((text) => PHONE.test(text))) hits.push("phone");
  if (texts.some((text) => EMAIL.test(text))) hits.push("email");
  return hits;
}
