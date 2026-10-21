/**
 * Failure Reasons (CONTEXT.md, ADR-0030): why an AI call (and, in later issues, a Back Office action)
 * failed or warned, in two parts.
 *
 *  - The functional reason: a stable code from FAILURE_REASONS, with its wording in every interface
 *    language (`failureReasons.<code>` in the i18n catalogues, read by `failureReasonWording` from
 *    `@jobhub/shared/i18n`, so this entry point loads no JSON). Countable, filterable, no personal data.
 *  - The technical reason: the error's class, provider, HTTP status and message, the message scrubbed of
 *    keys and secrets, passed through Redaction and cut at TECHNICAL_REASON_MAX_LENGTH characters. It only
 *    goes with the text it explains (the AI Message Log) or in the Back Office Audit, never in AI Usage
 *    nor in a Data export.
 *
 * `failureOf` reads an error by its shape (its `name`, `provider`, `status` and `reason`), so it serves the
 * AI layer's errors without importing them: an error may carry its own code as `reason`.
 */
import { scrubSecrets } from "./scrub-secrets";

/** How an AI call ended: it succeeded, worked while its feature ran degraded, or failed (or was never sent). */
export const OUTCOMES = ["ok", "warning", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** The catalog of Failure Reason codes. Later issues add theirs; `other` is any error not known here. */
export const FAILURE_REASONS = [
  /** The provider did not answer: a 5xx, a timeout, a network error. */
  "provider_unavailable",
  /** The provider refused the call: a 4xx other than 429, a refusal. */
  "provider_rejected",
  /** The provider's rate limit (429). */
  "rate_limited",
  /** The provider's key is not entered: the call was never sent. */
  "key_missing",
  /** No provider serves the task, or the one named cannot: the call was never sent. */
  "route_missing",
  /** The call would have broken a data residency rule: it was never sent. */
  "data_residency",
  /** The provider answered with something that could not be read. */
  "invalid_reply",
  // Back Office attempts that failed or were refused (#263): the Back Office Audit records them.
  /** A connection test, or a test sign-in, did not pass. */
  "test_failed",
  /** A test sign-in came back after its time was up. */
  "test_expired",
  /** A Sign-in Provider enabled before a test sign-in passed with its credentials. */
  "not_tested",
  /** Apple's private key could not sign a client secret. */
  "invalid_apple_key",
  /** A Playbook Version validated while a newer one exists. */
  "not_latest_version",
  "already_validated",
  /** A Playbook Version validated by one of its authors. */
  "own_version",
  /** A Coaching Playbook's version validated before any Eval Run was played on it. */
  "no_eval_run",
  /** A Guardrail setting that let through an Eval Case it must block. */
  "eval_refused",
  /** The last super-admin's role cannot be revoked. */
  "last_super_admin",
  /** No account holds that email. */
  "unknown_account",
  /** Stripe refused a Plan's product or a Coupon. */
  "stripe_refused",
  "other",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/** The codes an AI call can fail or warn with: the Journaux IA's Raison filter. */
export const AI_CALL_FAILURE_REASONS: readonly FailureReason[] = ["provider_unavailable", "provider_rejected", "rate_limited", "key_missing", "route_missing", "data_residency", "invalid_reply", "other"];

/** The codes a Back Office attempt can fail with (#263): the Back Office Audit's. */
export const BACK_OFFICE_FAILURE_REASONS: readonly FailureReason[] = FAILURE_REASONS.filter((reason) => !AI_CALL_FAILURE_REASONS.includes(reason) || reason === "other");

export function isFailureReason(value: unknown): value is FailureReason {
  return typeof value === "string" && (FAILURE_REASONS as readonly string[]).includes(value);
}

/** The longest technical message kept, in characters. */
export const TECHNICAL_REASON_MAX_LENGTH = 500;

/** The technical part of a Failure Reason. Only super-admins read it. */
export interface TechnicalReason {
  /** The error's class, e.g. "AiProviderError". */
  class: string;
  provider?: string;
  /** The provider's HTTP status, when it answered. */
  status?: number;
  /** Scrubbed, redacted and cut. */
  message: string;
}

export interface Failure {
  reason: FailureReason;
  technical: TechnicalReason;
}

export interface FailureOptions {
  /** The keys in use, scrubbed by value on top of whatever looks like a credential. */
  secrets?: readonly (string | undefined)[];
  /** Redaction (the Candidate's identity taken out): applied after scrubbing, before the cut. One that throws is skipped. */
  redact?: (text: string) => string;
}

/** `message` scrubbed, redacted and cut, in that order: a value cut in half is never left to leak. */
export function cleanTechnicalMessage(message: string, options: FailureOptions = {}): string {
  let clean = scrubSecrets(message, options.secrets);
  if (options.redact) {
    try {
      clean = options.redact(clean);
    } catch {
      // Redaction by its own rules failed: the scrubbed message is all there is.
    }
  }
  return clean.length <= TECHNICAL_REASON_MAX_LENGTH ? clean : `${clean.slice(0, TECHNICAL_REASON_MAX_LENGTH - 1)}…`;
}

function reasonOf(name: string, status: number | undefined, carried: unknown): FailureReason {
  if (isFailureReason(carried)) return carried;
  switch (name) {
    case "AiConfigError":
      return "route_missing";
    case "DataResidencyError":
      return "data_residency";
    case "AiProviderError":
      if (status === undefined || status === 408 || status >= 500) return "provider_unavailable";
      if (status === 429) return "rate_limited";
      if (status >= 400) return "provider_rejected";
      return "invalid_reply";
    default:
      return "other";
  }
}

/** The Failure Reason of whatever was thrown. Never throws. */
export function failureOf(error: unknown, options: FailureOptions = {}): Failure {
  const shaped = typeof error === "object" && error !== null ? (error as { name?: unknown; message?: unknown; provider?: unknown; status?: unknown; reason?: unknown }) : null;
  const name = error instanceof Error ? error.name : typeof shaped?.name === "string" ? shaped.name : "unknown";
  const status = typeof shaped?.status === "number" ? shaped.status : undefined;
  const provider = typeof shaped?.provider === "string" ? shaped.provider : undefined;
  const message = error instanceof Error ? error.message : typeof shaped?.message === "string" ? shaped.message : String(error);
  return {
    reason: reasonOf(name, status, shaped?.reason),
    technical: {
      class: name,
      ...(provider === undefined ? {} : { provider }),
      ...(status === undefined ? {} : { status }),
      message: cleanTechnicalMessage(message, options),
    },
  };
}
