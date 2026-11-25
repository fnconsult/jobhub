/**
 * Each AI provider's quota refusals (#1114), through its adapter: the error it raises carries the renewal date its
 * provider gave (`renewsAt`), and its Failure Reason tells a rate limit (`rate_limited`) from a credit or plan spent
 * (`quota_exhausted`).
 */
import { failureOf } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { AiProviderError } from "../errors";
import type { AiProvider } from "../types";
import { createAnthropicProvider } from "./anthropic";
import { createBraveProvider } from "./brave";
import { createMistralProvider, createOpenAiProvider } from "./chat-completions";
import { createPerplexityProvider } from "./perplexity";
import { createTavilyProvider } from "./tavily";

const answering = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })) as typeof globalThis.fetch;

type Make = (fetch: typeof globalThis.fetch) => AiProvider;

const anthropic: Make = (fetch) => createAnthropicProvider({ endpoint: { kind: "direct", apiKey: "k" }, fetch, maxRetries: 0 });
const anthropicOnBedrock: Make = (fetch) => createAnthropicProvider({ endpoint: { kind: "bedrock", region: "eu-west-3", apiKey: "k" }, fetch, maxRetries: 0 });
const openai: Make = (fetch) => createOpenAiProvider({ apiKey: "k", dataResidency: "us", fetch });
const mistral: Make = (fetch) => createMistralProvider({ apiKey: "k", fetch });
const perplexity: Make = (fetch) => createPerplexityProvider({ apiKey: "k", fetch });
const brave: Make = (fetch) => createBraveProvider({ apiKey: "k", fetch });
const tavily: Make = (fetch) => createTavilyProvider({ apiKey: "k", fetch });

/** The error the provider's call raises, generating or searching as it does. */
async function errorOf(provider: AiProvider): Promise<AiProviderError> {
  const call = provider.search
    ? provider.search("directeur financier Lyon", {})
    : provider.generate!({ messages: [{ role: "user", content: "Bonjour" }], maxTokens: 10 });
  const error: unknown = await call.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AiProviderError);
  return error as AiProviderError;
}

const anthropicError = (type: string, message: string) => ({ type: "error", error: { type, message } });
const openAiError = (message: string, type: string, code: string) => ({ error: { message, type, param: null, code } });
/** Claude's spend cap, as platform.claude.com/docs/en/api/rate-limits shows it. */
const CLAUDE_SPEND_CAP = {
  type: "error",
  error: {
    type: "rate_limit_error",
    message:
      "You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization's API tier. You will regain access on 2026-09-01 at 00:00 UTC.",
    details: { error_code: "enforced_spend_limit_reached" },
  },
};

describe("an AI provider refusing a call for its quota (#1114)", () => {
  it.each<[string, Make, number, unknown, "rate_limited" | "quota_exhausted" | "provider_unavailable"]>([
    ["Anthropic's credit balance too low", anthropic, 400, anthropicError("invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."), "quota_exhausted"],
    // The credit-balance wording through the Bedrock endpoint: not an answer Bedrock documents (AWS bills Claude there),
    // kept so it is read as on the Claude API whatever the endpoint.
    ["the credit-balance wording through the Bedrock endpoint", anthropicOnBedrock, 400, anthropicError("invalid_request_error", "Your credit balance is too low to access the Anthropic API."), "quota_exhausted"],
    // Claude's spend cap (platform.claude.com/docs/en/api/rate-limits, #1123): a 429 that is a credit spent.
    ["Claude's monthly spend cap", anthropic, 429, CLAUDE_SPEND_CAP, "quota_exhausted"],
    ["Claude's spend limit set by the organization", anthropic, 400, anthropicError("invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC."), "quota_exhausted"],
    // Bedrock's ServiceQuotaExceededException (@aws-sdk/client-bedrock-runtime@3.1177.0): a quota window.
    ["Bedrock's service quota exceeded", anthropicOnBedrock, 400, { message: "Your request exceeds the service quota for your account. You can resubmit your request later." }, "rate_limited"],
    ["Anthropic's rate limit", anthropic, 429, anthropicError("rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"), "rate_limited"],
    ["OpenAI's insufficient_quota", openai, 429, openAiError("You exceeded your current quota, please check your plan and billing details.", "insufficient_quota", "insufficient_quota"), "quota_exhausted"],
    ["OpenAI's rate limit", openai, 429, openAiError("Rate limit reached for requests", "requests", "rate_limit_exceeded"), "rate_limited"],
    ["Mistral's payment required", mistral, 402, { object: "error", message: "Payment required", type: "payment_required" }, "quota_exhausted"],
    // Mistral's error glossary (docs.mistral.ai): its wallet depleted, its rate limit, its model out of capacity (no quota).
    ["Mistral's wallet depleted", mistral, 402, { message: "Out of credits. Top up your balance to restore access.", type: "billing_wallet_depleted", param: null, code: "2308", raw_status_code: 402 }, "quota_exhausted"],
    ["Mistral's documented rate limit", mistral, 429, { message: "Rate limit exceeded", type: "rate_limited", param: null, code: "1300", raw_status_code: 429 }, "rate_limited"],
    ["Mistral's model out of capacity", mistral, 429, { message: "Model is out of capacity.", type: "backend_out_of_capacity", param: null, code: "3801", raw_status_code: 429 }, "provider_unavailable"],
    ["Mistral's rate limit", mistral, 429, { object: "error", message: "Requests rate limit exceeded", type: "rate_limited" }, "rate_limited"],
    ["Perplexity's credits spent", perplexity, 402, { error: { message: "Insufficient credits", type: "payment_required" } }, "quota_exhausted"],
    // What Perplexity answers once its credits are spent, as the Beta got it (#1123): a 401, its message saying so.
    [
      "Perplexity's 401 insufficient_quota",
      perplexity,
      401,
      { error: { message: "You exceeded your current quota, add credits at https://console.perplexity.ai/project/billing.", type: "insufficient_quota", code: 401 } },
      "quota_exhausted",
    ],
    ["Perplexity's rate limit", perplexity, 429, { error: { message: "rate limited", type: "rate_limit_exceeded" } }, "rate_limited"],
    ["Brave's plan quota", brave, 429, { type: "ErrorResponse", error: { status: 429, code: "QUOTA_LIMITED", detail: "Request quota limit exceeded for plan." } }, "quota_exhausted"],
    ["Brave's payment required", brave, 402, { type: "ErrorResponse", error: { status: 402, code: "SUBSCRIPTION_NOT_FOUND", detail: "Payment required." } }, "quota_exhausted"],
    ["Brave's rate limit", brave, 429, { type: "ErrorResponse", error: { status: 429, code: "RATE_LIMITED", detail: "Request rate limit exceeded for plan." } }, "rate_limited"],
    ["Tavily's plan limit (432)", tavily, 432, { detail: { error: "This request exceeds your plan's set usage limit." } }, "quota_exhausted"],
    ["Tavily's pay-as-you-go limit (433)", tavily, 433, { detail: { error: "This request exceeds the pay-as-you-go limit." } }, "quota_exhausted"],
    ["Tavily's rate limit", tavily, 429, { detail: { error: "Rate limit exceeded" } }, "rate_limited"],
  ])("%s is %s", async (_, make, status, body, reason) => {
    const error = await errorOf(make(answering(status, body)));

    expect(error.status).toBe(status);
    expect(failureOf(error).reason).toBe(reason);
  });

  it("carries the renewal date the provider gave in its retry-after, none when it gave none", async () => {
    const before = Date.now();
    const limited = await errorOf(openai(answering(429, openAiError("Rate limit reached", "requests", "rate_limit_exceeded"), { "retry-after": "20" })));
    expect(limited.renewsAt!.getTime()).toBeGreaterThanOrEqual(before + 20_000);
    expect(limited.renewsAt!.getTime()).toBeLessThan(Date.now() + 20_000 + 1);

    const claude = await errorOf(anthropic(answering(429, anthropicError("rate_limit_error", "slow down"), { "retry-after": "Tue, 24 Nov 2026 11:00:00 GMT" })));
    expect(claude.renewsAt).toEqual(new Date("2026-11-24T11:00:00Z"));

    // retry-after-ms first (#1123); Claude's spend cap, which sends no header, from its message.
    const fast = Date.now();
    const perplexityLimited = await errorOf(perplexity(answering(429, { error: { message: "rate limited" } }, { "retry-after-ms": "1500", "retry-after": "60" })));
    expect(perplexityLimited.renewsAt!.getTime()).toBeGreaterThanOrEqual(fast + 1_500);
    expect(perplexityLimited.renewsAt!.getTime()).toBeLessThan(Date.now() + 60_000);
    expect((await errorOf(anthropic(answering(429, CLAUDE_SPEND_CAP)))).renewsAt).toEqual(new Date("2026-09-01T00:00:00Z"));

    expect((await errorOf(tavily(answering(432, { detail: { error: "limit" } })))).renewsAt).toBeUndefined();
    // Not a quota refusal: no renewal date, whatever it said.
    expect((await errorOf(mistral(answering(401, { message: "Unauthorized" }, { "retry-after": "20" })))).renewsAt).toBeUndefined();
  });
});
