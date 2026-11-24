/**
 * Quota refusals (#1114): a Tool with an API whose provider counts its calls (an AI model, a web search provider, a
 * contact enrichment provider, Fantastic.jobs) refusing a call for its quota, in one of two Failure Reasons:
 *
 *  - `rate_limited` (« limite atteinte »): its rate limit, an HTTP 429;
 *  - `quota_exhausted` (« quota épuisé »): its credit or plan spent, however the provider says it.
 *
 *   quotaRefusalOf("openai", { status: 429, message, headers })   // { reason: "quota_exhausted", renewsAt? } | undefined
 *   hasQuota(tool)                                                // whether its Tool quota state is read at all
 *
 * Read from each provider's documented answers: Anthropic's 400 « credit balance is too low », OpenAI's 429
 * `insufficient_quota`, Tavily's 432 and 433, a 402 or a plan spent anywhere (`out_of_credits`, Brave's
 * `QUOTA_LIMITED`). The renewal date is the one the provider gave: its `retry-after`, or Fantastic.jobs' next billing
 * date for its plan spent. A Tool without a quota (a public API, a Tool of our own, Stripe whose 402 is a card
 * declined) has no quota refusal: its answers keep their own Failure Reason.
 */
import type { FailureReason } from "./failure-reasons";
import type { Tool } from "./tools";

/** The two Failure Reasons of a quota refusal. */
export type QuotaRefusalReason = Extract<FailureReason, "rate_limited" | "quota_exhausted">;

export interface QuotaRefusal {
  reason: QuotaRefusalReason;
  /** When the provider said its quota is renewed (or the wait it asked for is over); absent when it said nothing. */
  renewsAt?: Date;
}

/** What a provider answered, as far as it is known: no status when no answer came. */
export interface ProviderAnswer {
  status: number | null | undefined;
  /** Its error message or body, as far as it was read. */
  message?: string;
  headers?: Headers;
}

interface QuotaRules {
  /** The statuses by which it says its credit or plan is spent, besides a message that says so. */
  spent: readonly number[];
  /** The header holding the date its plan is renewed, read for its plan spent. */
  renewalHeader?: string;
}

const PAYMENT_REQUIRED: QuotaRules = { spent: [402] };

/**
 * The providers with a quota, by the id their calls are recorded under (`ai_usage.provider`, and the
 * `external_api_usage.provider` of their other calls): every Tool with an API whose provider counts its calls.
 */
const QUOTA_RULES: Readonly<Record<string, QuotaRules>> = {
  anthropic: PAYMENT_REQUIRED,
  anthropic_bedrock: PAYMENT_REQUIRED,
  mistral: PAYMENT_REQUIRED,
  openai: PAYMENT_REQUIRED,
  perplexity: PAYMENT_REQUIRED,
  brave: PAYMENT_REQUIRED,
  // 432: its plan's usage limit; 433: its pay-as-you-go limit.
  tavily: { spent: [402, 432, 433] },
  lusha: PAYMENT_REQUIRED,
  kaspr: PAYMENT_REQUIRED,
  apollo: PAYMENT_REQUIRED,
  fantastic_jobs: { spent: [402], renewalHeader: "x-api-next-billing-date" },
};

/**
 * How a provider says its credit or plan is spent, whatever the status: Anthropic's credit balance, OpenAI's and
 * Perplexity's `insufficient_quota`, Brave's `QUOTA_LIMITED`, contact enrichment's `out_of_credits`, a payment required.
 * Never a rate limit's words (« rate limit exceeded for plan »).
 */
const SPENT =
  /credit balance is too low|insufficient[_ ](?:quota|credits?|balance|funds)|exceeded your current quota|quota[_ ]limited|quota (?:limit )?(?:exceeded|exhausted|reached)|out[_ ]of[_ ]credits|payment[_ ]required/i;

/** The provider's quota refusal in `answer`; none for any other answer, no answer, and a provider without a quota. */
export function quotaRefusalOf(provider: string, answer: ProviderAnswer, now: Date = new Date()): QuotaRefusal | undefined {
  const rules = Object.hasOwn(QUOTA_RULES, provider) ? QUOTA_RULES[provider] : undefined;
  const { status } = answer;
  if (!rules || typeof status !== "number" || status < 400 || status >= 500) return undefined;
  const spent = rules.spent.includes(status) || SPENT.test(answer.message ?? "");
  if (!spent && status !== 429) return undefined;
  const reason: QuotaRefusalReason = spent ? "quota_exhausted" : "rate_limited";
  const renewsAt = answer.headers ? renewalOf(answer.headers, now, spent ? rules.renewalHeader : undefined) : undefined;
  return renewsAt ? { reason, renewsAt } : { reason };
}

/** The renewal date in `headers`: `renewalHeader`'s date when given and stated, else `retry-after` (seconds or a date). */
function renewalOf(headers: Headers, now: Date, renewalHeader: string | undefined): Date | undefined {
  const renewal = renewalHeader ? Date.parse(headers.get(renewalHeader) ?? "") : NaN;
  if (Number.isFinite(renewal)) return new Date(renewal);
  const retryAfter = headers.get("retry-after")?.trim();
  if (!retryAfter) return undefined;
  const at = /^\d+$/.test(retryAfter) ? now.getTime() + Number(retryAfter) * 1000 : Date.parse(retryAfter);
  return Number.isFinite(at) ? new Date(at) : undefined;
}

/** Whether `tool` has a quota at its provider: an AI model, a web search provider, a contact enrichment provider, Fantastic.jobs. */
export function hasQuota(tool: Tool): boolean {
  const usage = tool.usage;
  if (!usage) return false;
  return Object.hasOwn(QUOTA_RULES, usage.provider) || (usage.table === "ai_usage" && usage.external !== undefined && Object.hasOwn(QUOTA_RULES, usage.external));
}
