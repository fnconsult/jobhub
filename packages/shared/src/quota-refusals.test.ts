/**
 * Each provider's documented refusals (#1114), as its API answers them: a rate limit (« limite atteinte ») stays
 * `rate_limited`, a credit or plan spent (« quota épuisé ») is `quota_exhausted`.
 */
import { describe, expect, it } from "vitest";
import { failureOf } from "./failure-reasons";
import { hasQuota, quotaRefusalOf } from "./quota-refusals";
import { toolById, TOOLS, type Tool } from "./tools";

const json = (body: unknown) => JSON.stringify(body);
const now = new Date("2026-11-24T10:00:00Z");

/** Claude's spend cap, as platform.claude.com/docs/en/api/rate-limits shows it. */
const CLAUDE_SPEND_CAP = json({
  type: "error",
  error: {
    type: "rate_limit_error",
    message:
      "You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization's API tier. You will regain access on 2026-09-01 at 00:00 UTC.",
    details: { error_code: "enforced_spend_limit_reached" },
  },
});
/** Bedrock's ServiceQuotaExceededException, its message as @aws-sdk/client-bedrock-runtime@3.1177.0 documents it. */
const BEDROCK_SERVICE_QUOTA = json({ message: "Your request exceeds the service quota for your account. You can view your quotas at Viewing service quotas. You can resubmit your request later." });
/** Perplexity's answer once its credits were spent, as the Beta got it (#1123). */
const PERPLEXITY_SPENT = '{"error":{"message":"You exceeded your current quota, add credits at https://console.perplexity.ai/project/billing.","type":"insufficient_quota","code":401}}';

/** One documented answer per provider and case: its status and body, what it is classified as. */
const ANSWERS: [provider: string, status: number, body: string, reason: "rate_limited" | "quota_exhausted" | undefined][] = [
  // Anthropic (direct API, Bedrock, Vertex alike): the credit balance spent is a 400, a rate limit a 429.
  ["anthropic", 400, `400 ${json({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } })}`, "quota_exhausted"],
  ["anthropic", 429, `429 ${json({ type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" } })}`, "rate_limited"],
  ["anthropic", 400, `400 ${json({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: field required" } })}`, undefined],
  // The credit-balance wording, whichever of Claude's ids it is recorded under: not an answer Bedrock documents (AWS bills
  // Claude there), kept so the wording is read the same for any id.
  ["anthropic_bedrock", 400, "Your credit balance is too low to access the Anthropic API.", "quota_exhausted"],
  // Claude's monthly spend cap (platform.claude.com/docs/en/api/rate-limits, « Reaching your spend cap », #1123): a 429
  // whose error_code says so, its credit spent, not a rate limit; and the 402s of a contract or linked organization's limit.
  ["anthropic", 429, `429 ${CLAUDE_SPEND_CAP}`, "quota_exhausted"],
  ["anthropic", 429, `429 ${json({ type: "error", error: { type: "rate_limit_error", message: "Your organization has reached the spend limit of its contract.", details: { error_code: "contract_spend_limit_reached" } } })}`, "quota_exhausted"],
  ["anthropic", 402, `402 ${json({ type: "error", error: { type: "billing_error", message: "Spend limit reached.", details: { error_code: "linked_organization_spend_limit_reached" } } })}`, "quota_exhausted"],
  // A ramp limit is a rate limit (same page): it says to wait its retry-after.
  ["anthropic", 429, `429 ${json({ type: "error", error: { type: "rate_limit_error", message: "Rate limit exceeded while ramping up.", details: { error_code: "ramp_limit_exceeded" } } })}`, "rate_limited"],
  // The spend limit the organization or a workspace sets (platform.claude.com/docs/en/api/rate-limits): a 400.
  ["anthropic", 400, `400 ${json({ type: "error", error: { type: "invalid_request_error", message: "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC." } })}`, "quota_exhausted"],
  ["anthropic", 400, `400 ${json({ type: "error", error: { type: "invalid_request_error", message: "You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC." } })}`, "quota_exhausted"],
  // Bedrock's ServiceQuotaExceededException (@aws-sdk/client-bedrock-runtime@3.1177.0: HTTP 400, « You can resubmit your
  // request later »): a quota window, not a credit spent; under either id, Claude on Bedrock being recorded as anthropic.
  ["anthropic_bedrock", 400, BEDROCK_SERVICE_QUOTA, "rate_limited"],
  ["anthropic", 400, `400 ${BEDROCK_SERVICE_QUOTA}`, "rate_limited"],
  // OpenAI: both are a 429, told apart by `insufficient_quota`.
  ["openai", 429, `HTTP 429 ${json({ error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", param: null, code: "insufficient_quota" } })}`, "quota_exhausted"],
  ["openai", 429, `HTTP 429 ${json({ error: { message: "Rate limit reached for gpt-5.5 on requests per min (RPM): Limit 500, Used 500, Requested 1.", type: "requests", param: null, code: "rate_limit_exceeded" } })}`, "rate_limited"],
  // Mistral, Perplexity, Brave: a 402 or a plan spent, else a 429 is a rate limit.
  ["mistral", 402, `HTTP 402 ${json({ object: "error", message: "Payment required", type: "payment_required" })}`, "quota_exhausted"],
  ["mistral", 429, `HTTP 429 ${json({ object: "error", message: "Requests rate limit exceeded", type: "rate_limited" })}`, "rate_limited"],
  // Mistral's error glossary (docs.mistral.ai, #1123): its billing 402s (2300 to 2308), its rate limit 1300, and its
  // model out of capacity (3505, 3801), which is no refusal for the account's quota.
  ["mistral", 402, `HTTP 402 ${json({ message: "Out of credits. Top up your balance to restore access.", type: "billing_wallet_depleted", param: null, code: "2308", raw_status_code: 402 })}`, "quota_exhausted"],
  ["mistral", 429, `HTTP 429 ${json({ message: "Rate limit exceeded", type: "rate_limited", param: null, code: "1300", raw_status_code: 429 })}`, "rate_limited"],
  ["mistral", 429, `HTTP 429 ${json({ message: "Service tier capacity exceeded for this model.", type: "backend_out_of_capacity", param: null, code: "3505", raw_status_code: 429 })}`, undefined],
  ["mistral", 429, `HTTP 429 ${json({ message: "Model is out of capacity.", type: "backend_out_of_capacity", param: null, code: "3801", raw_status_code: 429 })}`, undefined],
  ["perplexity", 402, `HTTP 402 ${json({ error: { message: "Insufficient credits", type: "payment_required" } })}`, "quota_exhausted"],
  ["perplexity", 401, `HTTP 401 ${json({ error: { message: "You have insufficient quota. Please add credits to your account.", type: "insufficient_quota", code: 401 } })}`, "quota_exhausted"],
  // The answer the Beta got (#1123).
  ["perplexity", 401, `HTTP 401 ${PERPLEXITY_SPENT}`, "quota_exhausted"],
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

  it("reads retry-after-ms before retry-after, as the Anthropic, OpenAI and Perplexity SDKs do (#1123)", () => {
    expect(quotaRefusalOf("openai", { status: 429, headers: new Headers({ "retry-after-ms": "1500", "retry-after": "60" }) }, now)).toEqual({
      reason: "rate_limited",
      renewsAt: new Date("2026-11-24T10:00:01.500Z"),
    });
    // One that cannot be read: retry-after.
    expect(quotaRefusalOf("perplexity", { status: 429, headers: new Headers({ "retry-after-ms": "soon", "retry-after": "60" }) }, now)?.renewsAt).toEqual(new Date("2026-11-24T10:01:00Z"));
  });

  it("reads Claude's spend cap's renewal from its message, which no header gives (#1123)", () => {
    expect(quotaRefusalOf("anthropic", { status: 429, message: `429 ${CLAUDE_SPEND_CAP}`, headers: new Headers() }, now)).toEqual({
      reason: "quota_exhausted",
      renewsAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(quotaRefusalOf("anthropic", { status: 429, message: `429 ${CLAUDE_SPEND_CAP}` }, now)?.renewsAt).toEqual(new Date("2026-09-01T00:00:00Z"));
    // A header wins: it is the provider's own.
    expect(quotaRefusalOf("anthropic", { status: 429, message: `429 ${CLAUDE_SPEND_CAP}`, headers: new Headers({ "retry-after": "30" }) }, now)?.renewsAt).toEqual(new Date("2026-11-24T10:00:30Z"));
    // A date that cannot be one: none.
    expect(quotaRefusalOf("anthropic", { status: 429, message: "You will regain access on 2026-13-45 at 99:00 UTC.", headers: new Headers() }, now)).toEqual({ reason: "rate_limited" });
  });

  it("leaves Mistral's model out of capacity to its own Failure Reason: unavailable, never a quota (#1123)", () => {
    const error = { name: "AiProviderError", provider: "mistral", status: 429, message: `mistral: HTTP 429 ${json({ message: "Model is out of capacity.", type: "backend_out_of_capacity", code: "3801" })}` };
    expect(failureOf(error).reason).toBe("provider_unavailable");
    expect(failureOf({ ...error, message: `mistral: HTTP 429 ${json({ message: "Rate limit exceeded", type: "rate_limited", code: "1300" })}` }).reason).toBe("rate_limited");
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
