import { describe, expect, it } from "vitest";
import { FAILURE_REASONS, failureOf, isFailureReason, TECHNICAL_REASON_MAX_LENGTH } from "./failure-reasons";
import { failureReasonWording } from "./i18n";

/** Shaped like the AI layer's errors (packages/ai/src/errors.ts), which this module cannot import. */
class AiProviderError extends Error {
  override name = "AiProviderError";
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
  }
}
class AiConfigError extends Error {
  override name = "AiConfigError";
  constructor(
    message: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}
class DataResidencyError extends Error {
  override name = "DataResidencyError";
}

describe("Failure Reason of an error", () => {
  it("a provider's 5xx or network error is provider_unavailable, with the provider and HTTP status in the technical reason", () => {
    expect(failureOf(new AiProviderError("mistral", "HTTP 503 Service Unavailable", 503))).toEqual({
      reason: "provider_unavailable",
      technical: { class: "AiProviderError", provider: "mistral", status: 503, message: "mistral: HTTP 503 Service Unavailable" },
    });
    expect(failureOf(new AiProviderError("tavily", "network error")).reason).toBe("provider_unavailable");
  });

  it("a provider's 429 is rate_limited, another 4xx provider_rejected, an unreadable 2xx reply invalid_reply", () => {
    expect(failureOf(new AiProviderError("openai", "HTTP 429", 429)).reason).toBe("rate_limited");
    expect(failureOf(new AiProviderError("openai", "HTTP 400 bad request", 400)).reason).toBe("provider_rejected");
    expect(failureOf(new AiProviderError("openai", "HTTP 401", 401)).reason).toBe("provider_rejected");
    expect(failureOf(new AiProviderError("mistral", "response has no choices", 200)).reason).toBe("invalid_reply");
  });

  it("a configuration error is the code it carries, route_missing when it carries none; a residency error is data_residency", () => {
    expect(failureOf(new AiConfigError("Missing environment variable MISTRAL_API_KEY", "key_missing"))).toEqual({
      reason: "key_missing",
      technical: { class: "AiConfigError", message: "Missing environment variable MISTRAL_API_KEY" },
    });
    expect(failureOf(new AiConfigError('No provider configured for AI task "coaching"')).reason).toBe("route_missing");
    expect(failureOf(new DataResidencyError("must be EU-resident")).reason).toBe("data_residency");
  });

  it("anything else is other, whatever was thrown", () => {
    expect(failureOf(new TypeError("boom"))).toEqual({ reason: "other", technical: { class: "TypeError", message: "boom" } });
    expect(failureOf("a string")).toEqual({ reason: "other", technical: { class: "unknown", message: "a string" } });
    expect(failureOf(new AiConfigError("x", "not_a_code")).reason).toBe("route_missing");
  });

  it("the technical message is scrubbed of keys, then redacted, then cut at 500 characters", () => {
    const key = "sk-proj-4f9a1c2b7d8e3f6a5b4c";
    const message = `HTTP 400 key ${key} rejected for marie.dupont@example.fr ${"trop long ".repeat(60)}`;
    const { technical } = failureOf(new AiProviderError("openai", message, 400), {
      secrets: ["known-secret-value"],
      redact: (text) => text.replace("marie.dupont@example.fr", "[E-MAIL]"),
    });

    expect(technical.message).not.toContain(key);
    expect(technical.message).toContain("[redacted]");
    expect(technical.message).not.toContain("marie.dupont@example.fr");
    expect(technical.message).toContain("[E-MAIL]");
    expect(technical.message.length).toBeLessThanOrEqual(TECHNICAL_REASON_MAX_LENGTH);
    expect(TECHNICAL_REASON_MAX_LENGTH).toBe(500);
  });

  it("a redaction that throws leaves the scrubbed message cut, never the error", () => {
    const { technical } = failureOf(new Error("for marie@example.fr"), {
      redact: () => {
        throw new Error("no");
      },
    });
    expect(technical.message).toBe("for marie@example.fr");
  });
});

describe("Failure Reason catalog", () => {
  it("holds the codes of AI calls, each with a French and an English wording", () => {
    expect(FAILURE_REASONS).toEqual(["provider_unavailable", "provider_rejected", "rate_limited", "key_missing", "route_missing", "data_residency", "invalid_reply", "other"]);
    expect(failureReasonWording("other")).toBe("Erreur inattendue");
    expect(failureReasonWording("key_missing", "en")).toBe("API key missing");
    for (const code of FAILURE_REASONS) {
      expect(failureReasonWording(code, "fr")).not.toMatch(/failureReasons\./);
      expect(failureReasonWording(code, "en")).not.toMatch(/failureReasons\./);
    }
  });

  it("tells a code from any other value", () => {
    expect(isFailureReason("rate_limited")).toBe(true);
    expect(isFailureReason("nope")).toBe(false);
    expect(isFailureReason(undefined)).toBe(false);
  });
});
