import { describe, expect, it } from "vitest";
import { AI_CALL_FAILURE_REASONS, AI_CALL_WARNINGS, BACK_OFFICE_FAILURE_REASONS, FAILURE_REASONS, GUARDRAIL_FAILURE_REASONS, failureOf, isFailureReason, TECHNICAL_REASON_MAX_LENGTH } from "./failure-reasons";
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

  it("a call the person stopped (an AbortSignal's abort error) is stopped, worded « Arrêtée par la personne » (#325)", () => {
    const controller = new AbortController();
    controller.abort();
    expect(failureOf(controller.signal.reason)).toEqual({ reason: "stopped", technical: { class: "AbortError", message: "This operation was aborted" } });
    expect(failureReasonWording("stopped")).toBe("Arrêtée par la personne");
    expect(failureReasonWording("stopped", "en")).toBe("Stopped by the person");
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
  it("holds the codes of AI calls and of Back Office attempts, each with a French and an English wording", () => {
    expect(FAILURE_REASONS).toEqual([
      "provider_unavailable",
      "provider_rejected",
      "rate_limited",
      "key_missing",
      "route_missing",
      "data_residency",
      "invalid_reply",
      "stopped",
      "task_playbook_fallback",
      "task_playbook_unreadable",
      "task_playbook_section_missing",
      "task_playbook_agent_not_offered",
      "task_playbook_search_not_offered",
      "playbook_agent_skipped",
      "identity_unavailable",
      "identity_undeclared",
      "job_titles_unavailable",
      "company_news_unavailable",
      "cv_reading_fallback",
      "tailored_cv_refused",
      "match_score_text_unread",
      "match_score_too_slow",
      "test_failed",
      "test_expired",
      "not_tested",
      "invalid_apple_key",
      "not_latest_version",
      "already_validated",
      "own_version",
      "no_eval_run",
      "eval_refused",
      "last_super_admin",
      "unknown_account",
      "stripe_refused",
      "role_missing",
      "invalid_value",
      "reply_required",
      "already_handled",
      "guardrail_timeout",
      "invalid_verdict",
      "provider_error",
      "other",
    ]);
    expect(failureReasonWording("guardrail_timeout")).toBe("Contrôle trop long");
    expect(failureReasonWording("invalid_verdict")).toBe("Verdict du contrôle illisible");
    expect(failureReasonWording("provider_error")).toBe("Erreur du fournisseur");
    expect(failureReasonWording("eval_refused")).toBe("Refusé par l'Eval Run");
    expect(failureReasonWording("other")).toBe("Erreur inattendue");
    expect(failureReasonWording("role_missing")).toBe("Section hors de ses rôles");
    expect(failureReasonWording("invalid_value")).toBe("Valeur refusée par le réglage");
    expect(failureReasonWording("reply_required")).toBe("Une Question se traite avec une réponse");
    expect(failureReasonWording("already_handled")).toBe("Signalement déjà traité");
    expect(failureReasonWording("key_missing", "en")).toBe("API key missing");
    for (const code of FAILURE_REASONS) {
      expect(failureReasonWording(code, "fr")).not.toMatch(/failureReasons\./);
      expect(failureReasonWording(code, "en")).not.toMatch(/failureReasons\./);
    }
  });

  it("tells the codes of AI calls from those of Back Office attempts; both may be other", () => {
    expect(AI_CALL_FAILURE_REASONS).toEqual([
      "provider_unavailable",
      "provider_rejected",
      "rate_limited",
      "key_missing",
      "route_missing",
      "data_residency",
      "invalid_reply",
      "stopped",
      ...AI_CALL_WARNINGS,
      "other",
    ]);
    expect(BACK_OFFICE_FAILURE_REASONS).toEqual([
      // An AI routing Platform Setting refused on save as the AI layer would refuse it (#301).
      "key_missing",
      "route_missing",
      "data_residency",
      "test_failed",
      "test_expired",
      "not_tested",
      "invalid_apple_key",
      "not_latest_version",
      "already_validated",
      "own_version",
      "no_eval_run",
      "eval_refused",
      "last_super_admin",
      "unknown_account",
      "stripe_refused",
      "role_missing",
      "invalid_value",
      // A Signalement's status or reply refused (#376).
      "reply_required",
      "already_handled",
      "other",
    ]);
  });

  it("tells why a Guardrail could not check: timeout, a verdict that was not valid, the provider's error; never other", () => {
    expect(GUARDRAIL_FAILURE_REASONS).toEqual(["guardrail_timeout", "invalid_verdict", "provider_error"]);
  });

  it("words each AI call warning (#260) by what the feature did instead, naming no Candidate", () => {
    expect(AI_CALL_WARNINGS).toEqual([
      "task_playbook_fallback",
      "task_playbook_unreadable",
      "task_playbook_section_missing",
      "task_playbook_agent_not_offered",
      "task_playbook_search_not_offered",
      "playbook_agent_skipped",
      "identity_unavailable",
      "identity_undeclared",
      "job_titles_unavailable",
      "company_news_unavailable",
      "cv_reading_fallback",
      "tailored_cv_refused",
      "match_score_text_unread",
      "match_score_too_slow",
    ]);
    expect(failureReasonWording("job_titles_unavailable")).toBe("Recherche avec le seul titre des Critères");
    expect(failureReasonWording("company_news_unavailable")).toBe("Company Dossier construit sans actualités");
    expect(failureReasonWording("identity_unavailable", "en")).toBe("Identity unavailable: redacted by shape alone (emails, phone numbers)");
    // Fixed wording: no slot a Candidate's text could fill.
    for (const code of AI_CALL_WARNINGS) {
      expect(code).toMatch(/^[a-z_]+$/);
      expect(failureReasonWording(code, "fr")).not.toMatch(/\{\{/);
      expect(failureReasonWording(code, "en")).not.toMatch(/\{\{/);
    }
  });

  it("tells a code from any other value", () => {
    expect(isFailureReason("rate_limited")).toBe(true);
    expect(isFailureReason("task_playbook_fallback")).toBe(true);
    expect(isFailureReason("nope")).toBe(false);
    expect(isFailureReason(undefined)).toBe(false);
  });
});
