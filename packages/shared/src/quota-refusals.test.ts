/**
 * Each provider's documented refusals (#1114), as its API answers them: a rate limit (« limite atteinte ») stays
 * `rate_limited`, a credit or plan spent (« quota épuisé ») is `quota_exhausted`.
 */
import { describe, expect, it } from "vitest";
import { hasQuota, quotaRefusalOf } from "./quota-refusals";
import { toolById, TOOLS, type Tool } from "./tools";

const json = (body: unknown) => JSON.stringify(body);
const now = new Date("2026-11-24T10:00:00Z");

/** One documented answer per provider and case: its status and body, what it is classified as. */
const ANSWERS: [provider: string, status: number, body: string, reason: "rate_limited" | "quota_exhausted" | undefined][] = [
  // Anthropic (direct API, Bedrock, Vertex alike): the credit balance spent is a 400, a rate limit a 429.
  ["anthropic", 400, `400 ${json({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } })}`, "quota_exhausted"],
  ["anthropic", 429, `429 ${json({ type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" } })}`, "rate_limited"],
  ["anthropic", 400, `400 ${json({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: field required" } })}`, undefined],
  ["anthropic_bedrock", 400, "Your credit balance is too low to access the Anthropic API.", "quota_exhausted"],
  // OpenAI: both are a 429, told apart by `insufficient_quota`.
  ["openai", 429, `HTTP 429 ${json({ error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", param: null, code: "insufficient_quota" } })}`, "quota_exhausted"],
  ["openai", 429, `HTTP 429 ${json({ error: { message: "Rate limit reached for gpt-5.5 on requests per min (RPM): Limit 500, Used 500, Requested 1.", type: "requests", param: null, code: "rate_limit_exceeded" } })}`, "rate_limited"],
  // Mistral, Perplexity, Brave: a 402 or a plan spent, else a 429 is a rate limit.
  ["mistral", 402, `HTTP 402 ${json({ object: "error", message: "Payment required", type: "payment_required" })}`, "quota_exhausted"],
  ["mistral", 429, `HTTP 429 ${json({ object: "error", message: "Requests rate limit exceeded", type: "rate_limited" })}`, "rate_limited"],
  ["perplexity", 402, `HTTP 402 ${json({ error: { message: "Insufficient credits", type: "payment_required" } })}`, "quota_exhausted"],
  ["perplexity", 401, `HTTP 401 ${json({ error: { message: "You have insufficient quota. Please add credits to your account.", type: "insufficient_quota", code: 401 } })}`, "quota_exhausted"],
  ["perplexity", 429, `HTTP 429 ${json({ error: { message: "rate limited", type: "rate_limit_exceeded" } })}`, "rate_limited"],
  ["brave", 402, `HTTP 402 ${json({ type: "ErrorResponse", error: { status: 402, code: "SUBSCRIPTION_NOT_FOUND", detail: "Payment required." } })}`, "quota_exhausted"],
  ["brave", 429, `HTTP 429 ${json({ type: "ErrorResponse", error: { status: 429, code: "QUOTA_LIMITED", detail: "Request quota limit exceeded for plan." } })}`, "quota_exhausted"],
  ["brave", 429, `HTTP 429 ${json({ type: "ErrorResponse", error: { status: 429, code: "RATE_LIMITED", detail: "Request rate limit exceeded for plan." } })}`, "rate_limited"],
  // Tavily: 432 (its plan's limit) and 433 (its pay-as-you-go limit) are spent credits.
  ["tavily", 432, `HTTP 432 ${json({ detail: { error: "This request exceeds your plan's set usage limit. Please upgrade your plan or contact support@tavily.com" } })}`, "quota_exhausted"],
  ["tavily", 433, `HTTP 433 ${json({ detail: { error: "This request exceeds the pay-as-you-go limit. You can increase your limit on the Tavily dashboard." } })}`, "quota_exhausted"],
  ["tavily", 429, `HTTP 429 ${json({ detail: { error: "Rate limit exceeded" } })}`, "rate_limited"],
  // Lusha, Kaspr, Apollo: 402 `out_of_credits`, 429 a rate limit.
  ["lusha", 402, json({ error: "out_of_credits" }), "quota_exhausted"],
  ["lusha", 429, json({ message: "Too many requests" }), "rate_limited"],
  ["kaspr", 402, json({ error: "out_of_credits" }), "quota_exhausted"],
  ["kaspr", 429, "", "rate_limited"],
  ["apollo", 402, json({ error: "out_of_credits" }), "quota_exhausted"],
  ["apollo", 429, json({ message: "The maximum number of api calls allowed for api/v1/people/match is 600 times per hour." }), "rate_limited"],
  // Fantastic.jobs: a 402 is its plan spent, a 429 its rate limit.
  ["fantastic_jobs", 402, json({ message: "Quota exceeded" }), "quota_exhausted"],
  ["fantastic_jobs", 429, json({ message: "Too many requests" }), "rate_limited"],
];

describe("a provider's refusal for its quota (#1114)", () => {
  it.each(ANSWERS)("%s answering %i is %s", (provider, status, message, reason) => {
    expect(quotaRefusalOf(provider, { status, message })?.reason).toBe(reason);
  });

  it("keeps a rate limit apart from a spent credit, OpenAI's 429s included", () => {
    expect(quotaRefusalOf("openai", { status: 429, message: "insufficient_quota" })?.reason).toBe("quota_exhausted");
    expect(quotaRefusalOf("openai", { status: 429, message: "rate_limit_exceeded" })?.reason).toBe("rate_limited");
    expect(quotaRefusalOf("openai", { status: 429 })?.reason).toBe("rate_limited");
  });

  it("is none for an answer that is no refusal, no answer, or a Tool without a quota", () => {
    expect(quotaRefusalOf("openai", { status: 200 })).toBeUndefined();
    expect(quotaRefusalOf("openai", { status: 503 })).toBeUndefined();
    expect(quotaRefusalOf("openai", { status: undefined })).toBeUndefined();
    expect(quotaRefusalOf("openai", { status: null })).toBeUndefined();
    // Stripe's 402 is a card declined; a public API's 429 says nothing of a quota of ours.
    expect(quotaRefusalOf("stripe", { status: 402 })).toBeUndefined();
    expect(quotaRefusalOf("greenhouse", { status: 429 })).toBeUndefined();
    expect(quotaRefusalOf("france_travail", { status: 429 })).toBeUndefined();
  });

  it("reads the renewal date the provider gave: retry-after, in seconds or as a date", () => {
    expect(quotaRefusalOf("openai", { status: 429, headers: new Headers({ "retry-after": "30" }) }, now)).toEqual({
      reason: "rate_limited",
      renewsAt: new Date("2026-11-24T10:00:30Z"),
    });
    expect(quotaRefusalOf("brave", { status: 429, headers: new Headers({ "retry-after": "Tue, 24 Nov 2026 11:00:00 GMT" }) }, now)).toEqual({
      reason: "rate_limited",
      renewsAt: new Date("2026-11-24T11:00:00Z"),
    });
    // None given, or one that cannot be read: none.
    expect(quotaRefusalOf("openai", { status: 429 }, now)).toEqual({ reason: "rate_limited" });
    expect(quotaRefusalOf("openai", { status: 429, headers: new Headers({ "retry-after": "soon" }) }, now)).toEqual({ reason: "rate_limited" });
  });

  it("reads Fantastic.jobs' next billing date for its spent plan, its retry-after for its rate limit", () => {
    const headers = new Headers({ "x-api-next-billing-date": "2026-12-01T00:00:00Z", "retry-after": "60" });
    expect(quotaRefusalOf("fantastic_jobs", { status: 402, headers }, now)).toEqual({ reason: "quota_exhausted", renewsAt: new Date("2026-12-01T00:00:00Z") });
    expect(quotaRefusalOf("fantastic_jobs", { status: 429, headers }, now)).toEqual({ reason: "rate_limited", renewsAt: new Date("2026-11-24T10:01:00Z") });
  });
});

describe("the Tools with a quota", () => {
  it("are the Tools with an API whose provider counts its calls: AI models, web search, contact enrichment, Fantastic.jobs", () => {
    expect((TOOLS as readonly Tool[]).filter(hasQuota).map((tool) => tool.id)).toEqual([
      "anthropic",
      "anthropic-bedrock",
      "anthropic-vertex",
      "mistral",
      "openai",
      "perplexity",
      "brave",
      "tavily",
      "fantastic-jobs",
      "lusha",
      "kaspr",
      "apollo",
    ]);
  });

  it("leave out the public APIs and our own Tools", () => {
    for (const id of ["greenhouse", "france-travail", "geo-api-gouv", "job-site", "stripe", "email-intake"]) expect(hasQuota(toolById(id)!)).toBe(false);
    expect((TOOLS as readonly Tool[]).filter((tool) => tool.category === "local_routes").some(hasQuota)).toBe(false);
  });
});
