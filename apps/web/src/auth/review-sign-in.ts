/**
 * The store review's sign-in code (#981, #708): a fixed code the App Store's and Google Play's reviewers type, written in
 * the review notes, for one or two demo accounts named in the environment, never for any other address.
 *
 * Off unless the environment turns it on: `REVIEW_SIGN_IN=on`, `REVIEW_SIGN_IN_EMAILS` (one or two addresses) and
 * `REVIEW_SIGN_IN_CODE` (6 digits, a secret held in the server's `.env`, never in the repository). Anything missing or
 * malformed leaves it off (docs/ops/mobile.md, « Code de revue des stores »).
 *
 * It changes nothing but the code a sign-in email to a demo address carries (sign-in-code.ts): the reviewer still asks for
 * the email, then types the code on the same page, at the same endpoint, with the same 15 minutes, 5 tries and rate
 * limit, into the same session, its second step included (index.ts). Each use is written to the Back Office Audit.
 */

type Env = Record<string, string | undefined>;

/** The store review's sign-in, when it is on. */
export interface ReviewSignIn {
  /** The demo accounts' addresses, lowercased: one or two. */
  emails: readonly string[];
  /** The fixed 6-digit code. A secret: never logged, never recorded. */
  code: string;
}

/** How many demo accounts it may name, at most: a Candidate and a Human Coach. */
export const REVIEW_SIGN_IN_MAX_EMAILS = 2;

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const SIX_DIGITS = /^\d{6}$/;

/** A code anyone would try first: one digit six times, or six digits in a row, up or down. */
function isGuessable(code: string): boolean {
  if (/^(\d)\1{5}$/.test(code)) return true;
  const steps = [...code].slice(1).map((digit, index) => Number(digit) - Number(code[index]));
  return steps.every((step) => step === 1) || steps.every((step) => step === -1);
}

/** An address as the environment lists it. */
const normalisedEmail = (email: string) => email.trim().toLowerCase();

/**
 * The store review's sign-in from `env`, or null when it is off. Turned on (`REVIEW_SIGN_IN=on`) but misconfigured, it
 * stays off and says why in `warn`, never the code.
 */
export function reviewSignInFromEnv(env: Env, warn: (message: string) => void = (message) => console.warn(message)): ReviewSignIn | null {
  if (env.REVIEW_SIGN_IN?.trim() !== "on") return null;
  const off = (why: string) => {
    warn(`[review-sign-in] REVIEW_SIGN_IN=on but ${why}: the store review's sign-in code stays off`);
    return null;
  };
  const emails = [...new Set((env.REVIEW_SIGN_IN_EMAILS ?? "").split(",").map(normalisedEmail).filter(Boolean))];
  if (emails.length === 0) return off("REVIEW_SIGN_IN_EMAILS names no address");
  if (emails.length > REVIEW_SIGN_IN_MAX_EMAILS) return off(`REVIEW_SIGN_IN_EMAILS names more than ${REVIEW_SIGN_IN_MAX_EMAILS} addresses`);
  if (!emails.every((email) => EMAIL.test(email))) return off("REVIEW_SIGN_IN_EMAILS holds something that is not an address");
  const admins = (env.ADMIN_EMAILS ?? "").split(",").map(normalisedEmail);
  if (emails.some((email) => admins.includes(email))) return off("REVIEW_SIGN_IN_EMAILS names an address of ADMIN_EMAILS");
  const code = env.REVIEW_SIGN_IN_CODE?.trim() ?? "";
  if (!SIX_DIGITS.test(code)) return off("REVIEW_SIGN_IN_CODE is not 6 digits");
  if (isGuessable(code)) return off("REVIEW_SIGN_IN_CODE is too easy to guess");
  return { emails, code };
}

/**
 * Whether `email` is one of the demo accounts the store review's sign-in is on for: lowercased as Better Auth keys its
 * codes and accounts, never trimmed, so an address padded with spaces (another code row, another account) never matches.
 */
export const isReviewAddress = (review: ReviewSignIn | null | undefined, email: unknown): boolean =>
  Boolean(review) && typeof email === "string" && review!.emails.includes(email.toLowerCase());

/** The code a sign-in email to `email` carries: the fixed code for a demo address while it is on; none (a random one) otherwise. */
export const reviewCodeFor = (review: ReviewSignIn | null | undefined, email: string): string | undefined =>
  isReviewAddress(review, email) ? review!.code : undefined;
