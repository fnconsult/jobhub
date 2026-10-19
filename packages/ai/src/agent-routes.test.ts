import { describe, expect, it } from "vitest";
import { createAiLayer, DataResidencyError } from "./ai-layer";
import { AiConfigError } from "./errors";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

/**
 * Playbook Agents (#225): each one's own provider, model and effort, for one call of its task;
 * the data rules hold whatever it names.
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

  it("never takes personal data outside the EU, whatever the route names", async () => {
    const { ai, usOpenAi } = setUp();

    await expect(ai.generate({ task: "coaching", candidateId: "marie", prompt: "Bonjour", route: { provider: "openai" } })).rejects.toThrow(DataResidencyError);
    expect(usOpenAi.calls).toHaveLength(0);
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
  it("are those of the EU-resident text providers configured, each with how it handles effort", () => {
    const { ai } = setUp();

    expect(ai.agentModels()).toEqual([
      {
        provider: "anthropic",
        endpoint: "fake anthropic",
        defaultModel: "fake-anthropic",
        models: [
          { model: "anthropic.claude-sonnet-5-5", effort: "native" },
          { model: "anthropic.claude-opus-5-5", effort: "native" },
          { model: "anthropic.claude-haiku-5-5", effort: "native" },
        ],
      },
      {
        provider: "mistral",
        endpoint: "fake mistral",
        defaultModel: "fake-mistral",
        models: [
          { model: "mistral-large-latest", effort: "ignored" },
          { model: "mistral-medium-3-5", effort: "medium_as_high" },
        ],
      },
    ]);
  });

  it("leave out a provider reached only outside the EU", () => {
    const { ai } = setUp();

    expect(ai.agentModels().some((choice) => choice.provider === "openai")).toBe(false);
  });
});
