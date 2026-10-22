import { createAiLayerFromEnv } from "@jobhub/ai";
import { createMemoryUsageLog } from "@jobhub/ai/testing";
import { describe, expect, it } from "vitest";
import { createSecretResolver, liveObject, type StoredSecrets } from "../provider-secrets/resolver";
import { AI_ROUTING_NAMES, aiRoutingCheck, withPlatformSettings } from "./ai-routing";
import { createPlatformSettingsResolver } from "./resolver";
import type { StoredPlatformSettings } from "./resolver";

/** Answers every Claude call, wherever it is reached. */
const claudeFetch = (async () =>
  new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } }), {
    headers: { "content-type": "application/json" },
  })) as typeof globalThis.fetch;

describe("the AI layer over the Provider Secrets and the Platform Settings (#301)", () => {
  const env = { ANTHROPIC_ENDPOINT: "bedrock", PERPLEXITY_API_KEY: "pk", ANTHROPIC_API_KEY: "env-key" };

  function resolvers(secrets: StoredSecrets, settings: StoredPlatformSettings) {
    const stored = { secrets, settings };
    const resolver = withPlatformSettings(
      createSecretResolver({ env, load: async () => stored.secrets, log: () => {} }),
      createPlatformSettingsResolver({ env, load: async () => stored.settings, log: () => {} }),
    );
    return { resolver, stored };
  }

  it("is configured through env alone while the Back Office sets nothing", async () => {
    const { resolver } = resolvers({}, {});
    await resolver.refresh();

    expect(resolver.current().env).toMatchObject(env);
  });

  it("takes the Back Office's settings over env, and the Provider Secrets as before", async () => {
    const { resolver } = resolvers({ ANTHROPIC_API_KEY: { value: "db-key", row: "r1" } }, { ANTHROPIC_ENDPOINT: { value: "auto", updatedBy: "ops@jobbbox.ai", updatedAt: new Date() } });
    await resolver.refresh();

    expect(resolver.current().env).toMatchObject({ ANTHROPIC_ENDPOINT: "auto", ANTHROPIC_API_KEY: "db-key", PERPLEXITY_API_KEY: "pk" });
  });

  it("rebuilds the AI layer when ANTHROPIC_ENDPOINT is switched in the Back Office: the next call is recorded on the new endpoint", async () => {
    const { resolver, stored } = resolvers({ AWS_BEARER_TOKEN_BEDROCK: { value: "bk", row: "r1" } }, {});
    await resolver.refresh();
    const usage = createMemoryUsageLog();
    const ai = liveObject(resolver, [...AI_ROUTING_NAMES, "ANTHROPIC_API_KEY", "AWS_BEARER_TOKEN_BEDROCK", "PERPLEXITY_API_KEY"], (built) =>
      createAiLayerFromEnv(built, { fetch: claudeFetch, usage }),
    );

    await ai.generate({ task: "offer_analysis", candidateId: null, prompt: "Offre" });
    stored.settings = { ANTHROPIC_ENDPOINT: { value: "auto", updatedBy: "ops@jobbbox.ai", updatedAt: new Date() } };
    await resolver.refresh();
    await ai.generate({ task: "offer_analysis", candidateId: null, prompt: "Offre" });

    // bedrock: every task on Bedrock; auto, with both keys: the direct API first for a task without personal data.
    expect(usage.entries.map((entry) => entry.endpoint)).toEqual(["bedrock eu-north-1", "api.anthropic.com"]);
  });

  it("says a new version when one of the names' setting or key changes, and only then", async () => {
    const { resolver, stored } = resolvers({}, {});
    await resolver.refresh();
    const names = ["ANTHROPIC_ENDPOINT", "MISTRAL_API_KEY"];
    const first = resolver.current().versionOf(names);

    stored.settings = { JOB_DIGEST_TARGET_COUNT: { value: "12", updatedBy: "ops@jobbbox.ai", updatedAt: new Date() } };
    expect((await resolver.refresh()).versionOf(names)).toBe(first);
    stored.settings = { ANTHROPIC_ENDPOINT: { value: "auto", updatedBy: "ops@jobbbox.ai", updatedAt: new Date() } };
    const second = (await resolver.refresh()).versionOf(names);
    expect(second).not.toBe(first);
    stored.secrets = { MISTRAL_API_KEY: { value: "mk", row: "r2" } };
    expect((await resolver.refresh()).versionOf(names)).not.toBe(second);
  });
});

describe("the check of an AI routing change on Paramètres (#301)", () => {
  const settingsEnv = { ANTHROPIC_ENDPOINT: "bedrock" };
  // The keys come from the Provider Secrets (Clés), not from the settings' env.
  const check = aiRoutingCheck(() => ({ AWS_BEARER_TOKEN_BEDROCK: "bk", PERPLEXITY_API_KEY: "pk", OPENAI_API_KEY: "ok" }));

  it("refuses a task with personal data routed outside the EU, with the keys in use", async () => {
    const refusal = await check({ name: "OPENAI_DATA_RESIDENCY", before: { ...settingsEnv, AI_SCORING_PROVIDER: "openai" }, after: { ...settingsEnv, AI_SCORING_PROVIDER: "openai", OPENAI_DATA_RESIDENCY: "us" } });

    expect(refusal).toMatchObject({ reason: "data_residency" });
  });

  it("lets a valid change through, and leaves the other Platform Settings to their own rules", async () => {
    expect(await check({ name: "ANTHROPIC_ENDPOINT", before: settingsEnv, after: { ANTHROPIC_ENDPOINT: "auto" } })).toBeNull();
    expect(await check({ name: "JOB_DIGEST_TARGET_COUNT", before: { ...settingsEnv, AI_SCORING_PROVIDER: "perplexity" }, after: { ...settingsEnv, AI_SCORING_PROVIDER: "perplexity", JOB_DIGEST_TARGET_COUNT: "12" } })).toBeNull();
  });
});
