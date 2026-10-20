import { describe, expect, it } from "vitest";
import { agentModelValue, effortOf, outsideEu, playbookVersionFromForm } from "./playbook-form";

function form(fields: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

const MODELS = [
  { provider: "mistral" as const, endpoint: "api.mistral.ai", residency: "eu" as const, defaultModel: "mistral-large-latest", models: [{ model: "mistral-medium-3-5", effort: "medium_as_high" as const, residency: "eu" as const }] },
  {
    provider: "anthropic" as const,
    endpoint: "api.anthropic.com, bedrock eu-west-3",
    residency: "eu" as const,
    defaultModel: "anthropic.claude-opus-5-5",
    models: [
      { model: "anthropic.claude-opus-5-5", effort: "native" as const, residency: "eu" as const },
      { model: "claude-opus-5-5", effort: "native" as const, residency: "outside_eu" as const },
    ],
  },
  { provider: "openai" as const, endpoint: "api.openai.com", residency: "outside_eu" as const, defaultModel: "gpt-5", models: [{ model: "gpt-5", effort: "native" as const, residency: "outside_eu" as const }] },
];

describe("the Playbook Version form of the Back Office (#225)", () => {
  it("reads the rules, the Playbook Agent's model as provider and model, its effort and when to consult it", () => {
    expect(
      playbookVersionFromForm(
        form([
          ["id", " salary-negotiation "],
          ["content", "# Salaire"],
          ["agentModel", agentModelValue("mistral", "mistral-medium-3-5")],
          ["effort", "high"],
          ["consultWhen", "Quand il parle de salaire."],
        ]),
      ),
    ).toEqual({
      id: "salary-negotiation",
      content: "# Salaire",
      provider: "mistral",
      model: "mistral-medium-3-5",
      effort: "high",
      consultWhen: "Quand il parle de salaire.",
      searchProvider: "",
      searchModel: "",
    });
  });

  it("reads the provider's default model as no model, and a form without agent fields as rules alone", () => {
    expect(playbookVersionFromForm(form([["content", "# Socle"], ["agentModel", agentModelValue("anthropic", null)]]))).toMatchObject({ provider: "anthropic", model: "" });
    expect(playbookVersionFromForm(form([["content", "# Socle"]]))).toEqual({ id: "", content: "# Socle", provider: "", model: "", effort: "", consultWhen: "", searchProvider: "", searchModel: "" });
  });

  it("reads a task Playbook's web-search provider and model, and none for the configured web-search route (ADR-0026)", () => {
    expect(playbookVersionFromForm(form([["content", "x"], ["searchModel", agentModelValue("tavily", "advanced")]]))).toMatchObject({ searchProvider: "tavily", searchModel: "advanced" });
    expect(playbookVersionFromForm(form([["content", "x"], ["searchModel", agentModelValue("brave", null)]]))).toMatchObject({ searchProvider: "brave", searchModel: "" });
    expect(playbookVersionFromForm(form([["content", "x"], ["searchModel", ""]]))).toMatchObject({ searchProvider: "", searchModel: "" });
  });

  it("says which models run outside the EU, so their option says so", () => {
    expect(outsideEu(MODELS, "openai", null)).toBe(true);
    expect(outsideEu(MODELS, "openai", "gpt-5")).toBe(true);
    expect(outsideEu(MODELS, "mistral", "mistral-medium-3-5")).toBe(false);
    expect(outsideEu(MODELS, "anthropic", null)).toBe(false);
    expect(outsideEu(MODELS, "anthropic", "claude-opus-5-5")).toBe(true);
    expect(outsideEu(MODELS, "perplexity", null)).toBe(false);
  });

  it("says how a Playbook Agent's model takes its effort, the provider's default model included", () => {
    expect(effortOf(MODELS, "mistral", "mistral-medium-3-5")).toBe("medium_as_high");
    expect(effortOf(MODELS, "anthropic", null)).toBe("native");
    expect(effortOf(MODELS, "mistral", null)).toBe("ignored");
    expect(effortOf(MODELS, "openai", "gpt-5")).toBe("native");
  });
});
