import { describe, expect, it } from "vitest";
import { createAiLayer } from "./ai-layer";
import { AiConfigError } from "./errors";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

/**
 * Playbook Agents (#225): each one's own provider, model and effort, for one call of its task, any text
 * provider configured; the call is redacted whatever it names, and EU AI Consent still holds.
 */
function setUp(consenting: string[] = []) {
  const claude = createFakeProvider({ id: "anthropic", reply: "from claude", models: ["anthropic.claude-opus-5-5", "anthropic.claude-haiku-5-5"] });
  const mistral = createFakeProvider({ id: "mistral", reply: "from mistral", models: ["mistral-large-latest", "mistral-medium-3-5"] });
  const usOpenAi = createFakeProvider({ id: "openai", residency: "outside_eu", reply: "from openai", models: ["gpt-5"] });
  const usage = createMemoryUsageLog();
  const ai = createAiLayer({
    providers: [claude, mistral, usOpenAi],
    routes: { coaching: { provider: "anthropic", model: "anthropic.claude-sonnet-5-5" }, offer_analysis: "openai" },
    identityRoute: { provider: "mistral" },
    euAiConsent: async (candidateId) => consenting.includes(candidateId),
    usage,
  });
  return { ai, claude, mistral, usOpenAi, usage };
}

describe("a call on a route of its own, with an effort (#225)", () => {
  it("goes to the provider and model it names, with its effort, and is recorded as such", async () => {
    const { ai, claude, mistral, usage } = setUp();

    const result = await ai.generate({ task: "coaching", candidateId: "marie", prompt: "Mon entretien ?", route: { provider: "mistral", model: "mistral-medium-3-5" }, effort: "low" });

    expect(result).toMatchObject({ text: "from mistral", provider: "mistral", model: "mistral-medium-3-5" });
    expect(mistral.calls[0]).toMatchObject({ model: "mistral-medium-3-5", effort: "low" });
    expect(claude.calls).toHaveLength(0);
    expect(usage.entries).toEqual([expect.objectContaining({ task: "coaching", provider: "mistral", model: "mistral-medium-3-5" })]);
  });

  it("uses the provider's default model when the route names none", async () => {
    const { ai, claude } = setUp();

    await ai.generate({ task: "coaching", candidateId: "marie", prompt: "Bonjour", route: { provider: "anthropic" } });

    expect(claude.calls[0]!.model).toBeUndefined();
  });

  it("may go outside the EU for a task with personal data, redacted (ADR-0007 amendment, 2026-10-20)", async () => {
    const { ai, usOpenAi } = setUp();

    await expect(ai.generate({ task: "coaching", candidateId: "marie", prompt: "Écrivez-moi : marie@example.fr", route: { provider: "openai" } })).resolves.toMatchObject({ provider: "openai" });
    expect(usOpenAi.calls[0]!.messages[0]!.content).toBe("Écrivez-moi : [E-MAIL]");
  });

  it("refuses a provider that is not configured", async () => {
    const { ai } = setUp();

    await expect(ai.generate({ task: "coaching", candidateId: "marie", prompt: "Bonjour", route: { provider: "perplexity" } })).rejects.toThrow(AiConfigError);
  });

  it("follows EU AI Consent when it carries the Candidate's identity: it then goes to the identity route", async () => {
    const { ai, claude, mistral } = setUp(["marie"]);

    const result = await ai.generate({ task: "coaching", candidateId: "marie", prompt: "Appelez-moi au 06 12 34 56 78", route: { provider: "anthropic" }, effort: "high" });

    expect(result.provider).toBe("mistral");
    expect(mistral.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(0);
  });
});

describe("the models a Playbook Agent may use (#225)", () => {
  it("are those of every text provider configured, outside the EU too, each with how it handles effort and where it runs", () => {
    const { ai } = setUp();

    expect(ai.agentModels()).toEqual([
      {
        provider: "anthropic",
        endpoint: "fake anthropic",
        residency: "eu",
        defaultModel: "fake-anthropic",
        models: [
          { model: "anthropic.claude-sonnet-5-5", effort: "native", residency: "eu" },
          { model: "anthropic.claude-opus-5-5", effort: "native", residency: "eu" },
          { model: "anthropic.claude-haiku-5-5", effort: "native", residency: "eu" },
        ],
      },
      {
        provider: "mistral",
        endpoint: "fake mistral",
        residency: "eu",
        defaultModel: "fake-mistral",
        models: [
          { model: "mistral-large-latest", effort: "ignored", residency: "eu" },
          { model: "mistral-medium-3-5", effort: "medium_as_high", residency: "eu" },
        ],
      },
      {
        provider: "openai",
        endpoint: "fake openai",
        residency: "outside_eu",
        defaultModel: "fake-openai",
        models: [{ model: "gpt-5", effort: "native", residency: "outside_eu" }],
      },
    ]);
  });

  it("offer a provider reached through several endpoints once, each model with the endpoint serving it", () => {
    const direct = { ...createFakeProvider({ id: "anthropic", residency: "outside_eu", models: ["claude-opus-5-5"] }), endpoint: "api.anthropic.com" };
    const bedrock = { ...createFakeProvider({ id: "anthropic", models: ["anthropic.claude-opus-5-5"] }), endpoint: "bedrock eu-west-3" };
    const ai = createAiLayer({ providers: [direct, bedrock], routes: { scoring: "anthropic" }, usage: createMemoryUsageLog() });

    expect(ai.agentModels()).toEqual([
      expect.objectContaining({
        provider: "anthropic",
        endpoint: "api.anthropic.com, bedrock eu-west-3",
        residency: "eu",
        models: [
          { model: "claude-opus-5-5", effort: "native", residency: "outside_eu" },
          { model: "anthropic.claude-opus-5-5", effort: "native", residency: "eu" },
        ],
      }),
    ]);
  });

  it("go to the endpoint that names the model chosen", async () => {
    const direct = { ...createFakeProvider({ id: "anthropic", residency: "outside_eu", models: ["claude-opus-5-5"] }), endpoint: "api.anthropic.com" };
    const bedrock = { ...createFakeProvider({ id: "anthropic", models: ["anthropic.claude-opus-5-5"] }), endpoint: "bedrock eu-west-3" };
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [direct, bedrock], routes: { offer_analysis: "anthropic" }, usage });

    await ai.generate({ task: "offer_analysis", candidateId: null, prompt: "Offre", route: { provider: "anthropic", model: "anthropic.claude-opus-5-5" } });

    expect(usage.entries[0]).toMatchObject({ endpoint: "bedrock eu-west-3", model: "anthropic.claude-opus-5-5" });
  });

  it("never include a web-search provider, which cannot write", () => {
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral" }), { ...createFakeProvider({ id: "perplexity", residency: "outside_eu" }), generate: undefined }], routes: { web_search: "perplexity" }, usage: createMemoryUsageLog() });

    expect(ai.agentModels().map((choice) => choice.provider)).toEqual(["mistral"]);
  });
});
