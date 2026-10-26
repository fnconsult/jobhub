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
 * Web search is unavailable: the Search provider of the call (the active one, or a task Playbook's) has no key
 * entered (#399, ADR-0043). Every other AI task still works; a feature searching the web skips its search, as a
 * disabled source, or refuses with its own message. Its Failure Reason is `key_missing`; its message names the key.
 */
export class WebSearchUnavailable extends AiConfigError {
  override name = "WebSearchUnavailable";
  constructor(detail: string) {
    super(`Web search is unavailable: ${detail}`, { reason: "key_missing" });
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
