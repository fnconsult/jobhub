import { scrubSecrets, type FailureReason } from "@jobhub/shared";
import type { ProviderId } from "./types";

/** Thrown when a call would send personal data to an endpoint outside the EU (ADR-0007). */
export class DataResidencyError extends Error {
  override name = "DataResidencyError";
}

/**
 * The AI layer is misconfigured: missing key, unknown provider, task routed to a provider that cannot serve it.
 * Its Failure Reason (`reason`): `key_missing` for a key not entered, else `route_missing`.
 */
export class AiConfigError extends Error {
  override name = "AiConfigError";
  readonly reason: FailureReason;
  constructor(message: string, options?: { reason?: Extract<FailureReason, "key_missing" | "route_missing"> }) {
    super(message);
    this.reason = options?.reason ?? "route_missing";
  }
}

/**
 * A provider call failed: HTTP error, refusal or unreadable response. Its message is
 * scrubbed of the keys in `options.secrets` and of anything that looks like a
 * credential (a provider may echo the key it was sent), so it can be logged or stored.
 */
export class AiProviderError extends Error {
  override name = "AiProviderError";
  /** Its Failure Reason when the status does not tell it (a refusal); else read from `status` (failureOf). */
  readonly reason?: FailureReason;
  constructor(
    readonly provider: ProviderId,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown; secrets?: readonly (string | undefined)[]; reason?: FailureReason },
  ) {
    super(`${provider}: ${scrubSecrets(message, options?.secrets)}`, options?.cause === undefined ? undefined : { cause: options.cause });
    if (options?.reason) this.reason = options.reason;
  }
}
