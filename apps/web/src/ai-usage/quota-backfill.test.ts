/**
 * The calls refused for their quota before #1114 (#1123): kept `provider_rejected`, reclassified `quota_exhausted` when
 * their technical message says a credit spent, by the same rule as `quotaRefusalOf`.
 */
import { quotaRefusalOf, SPENT_PATTERN } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { backfillQuotaRefusals, migrateAiUsage } from "./index";

/** What Perplexity answered the Beta once its credits were spent, as the AI layer kept it. */
const PERPLEXITY_SPENT =
  'perplexity: HTTP 401 {"error":{"message":"You exceeded your current quota, add credits at https://console.perplexity.ai/project/billing.","type":"insufficient_quota","code":401}}';
const RATE_LIMIT = "perplexity: HTTP 401 rate limit exceeded";

describe.skipIf(!connectionString)("the backfill of quota refusals recorded before #1114 (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateAiUsage(database);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  /** One call as recorded before #1114, with its technical reason in the AI Message Log (none: the log was purged). */
  async function call(provider: string, outcome: string, reason: string | null, message: string | null): Promise<string> {
    const { rows } = await database.query<{ id: string }>(
      `INSERT INTO ai_usage (at, task, provider, endpoint, model, input_tokens, output_tokens, cost_eur, ok, duration_ms, outcome, reason)
       VALUES ('2026-11-20T10:00:00Z', 'web_search', $1, 'perplexity', 'fast', 0, 0, 0, $2 <> 'failed', 120, $2, $3) RETURNING id`,
      [provider, outcome, reason],
    );
    const id = rows[0]!.id;
    if (message !== null) {
      await database.query(
        `INSERT INTO ai_message_log (usage_id, at, messages, technical_reason) VALUES ($1, '2026-11-20T10:00:00Z', '[]', $2::jsonb)`,
        [id, JSON.stringify({ class: "AiProviderError", provider, status: 401, message })],
      );
    }
    return id;
  }

  const reasonOf = async (id: string) => (await database.query<{ reason: string | null }>(`SELECT reason FROM ai_usage WHERE id = $1`, [id])).rows[0]!.reason;

  it("reclassifies a failed call of a provider with a quota whose message says its credit spent, and nothing else", async () => {
    const spent = await call("perplexity", "failed", "provider_rejected", PERPLEXITY_SPENT);
    const openai = await call("openai", "failed", "provider_rejected", "openai: HTTP 403 insufficient_quota");
    const rateLimit = await call("perplexity", "failed", "provider_rejected", RATE_LIMIT);
    const purged = await call("perplexity", "failed", "provider_rejected", null);
    const noQuota = await call("google_places", "failed", "provider_rejected", PERPLEXITY_SPENT);
    const otherReason = await call("perplexity", "failed", "key_missing", PERPLEXITY_SPENT);
    const warning = await call("perplexity", "warning", "provider_rejected", PERPLEXITY_SPENT);
    const noReason = await call("perplexity", "failed", null, PERPLEXITY_SPENT);

    expect(await backfillQuotaRefusals(database)).toBe(2);

    expect(await reasonOf(spent)).toBe("quota_exhausted");
    expect(await reasonOf(openai)).toBe("quota_exhausted");
    expect(await reasonOf(rateLimit)).toBe("provider_rejected");
    expect(await reasonOf(purged)).toBe("provider_rejected");
    expect(await reasonOf(noQuota)).toBe("provider_rejected");
    expect(await reasonOf(otherReason)).toBe("key_missing");
    expect(await reasonOf(warning)).toBe("provider_rejected");
    expect(await reasonOf(noReason)).toBeNull();
  });

  it("can be run again: it changes nothing more", async () => {
    const spent = await call("perplexity", "failed", "provider_rejected", PERPLEXITY_SPENT);
    await backfillQuotaRefusals(database);

    expect(await backfillQuotaRefusals(database)).toBe(0);
    expect(await reasonOf(spent)).toBe("quota_exhausted");
  });

  it("tells a credit spent from anything else as quotaRefusalOf does", async () => {
    const messages = [PERPLEXITY_SPENT, RATE_LIMIT, "Rate limit exceeded for plan.", "Your credit balance is too low", "QUOTA_LIMITED", "out_of_credits", "Invalid API key"];
    for (const message of messages) {
      const { rows } = await database.query<{ spent: boolean }>(`SELECT $1::text ~* $2::text AS spent`, [message, SPENT_PATTERN]);
      expect(rows[0]!.spent, message).toBe(quotaRefusalOf("perplexity", { status: 401, message })?.reason === "quota_exhausted");
    }
    expect(quotaRefusalOf("perplexity", { status: 401, message: PERPLEXITY_SPENT })?.reason).toBe("quota_exhausted");
    expect(quotaRefusalOf("perplexity", { status: 401, message: RATE_LIMIT })).toBeUndefined();
  });
});
