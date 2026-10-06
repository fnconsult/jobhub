import type { ProviderId } from "./types";

/** Thrown when a call would send personal data to an endpoint outside the EU (ADR-0007). */
export class DataResidencyError extends Error {
  override name = "DataResidencyError";
}

/** The AI layer is misconfigured: missing key, unknown provider, task routed to a provider that cannot serve it. */
export class AiConfigError extends Error {
  override name = "AiConfigError";
}

/** A provider call failed: HTTP error, refusal or unreadable response. */
export class AiProviderError extends Error {
  override name = "AiProviderError";
  constructor(
    readonly provider: ProviderId,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(`${provider}: ${message}`, options);
  }
}
