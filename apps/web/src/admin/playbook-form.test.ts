import { describe, expect, it } from "vitest";
import { agentModelValue, effortOf, playbookVersionFromForm } from "./playbook-form";

function form(fields: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

const MODELS = [
  { provider: "mistral" as const, endpoint: "api.mistral.ai", defaultModel: "mistral-large-latest", models: [{ model: "mistral-medium-3-5", effort: "medium_as_high" as const }] },
  { provider: "anthropic" as const, endpoint: "bedrock eu-west-3", defaultModel: "anthropic.claude-opus-5-5", models: [{ model: "anthropic.claude-opus-5-5", effort: "native" as const }] },
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
    ).toEqual({ id: "salary-negotiation", content: "# Salaire", provider: "mistral", model: "mistral-medium-3-5", effort: "high", consultWhen: "Quand il parle de salaire." });
  });

  it("reads the provider's default model as no model, and a form without agent fields as rules alone", () => {
    expect(playbookVersionFromForm(form([["content", "# Socle"], ["agentModel", agentModelValue("anthropic", null)]]))).toMatchObject({ provider: "anthropic", model: "" });
    expect(playbookVersionFromForm(form([["content", "# Socle"]]))).toEqual({ id: "", content: "# Socle", provider: "", model: "", effort: "", consultWhen: "" });
  });

  it("says how a Playbook Agent's model takes its effort, the provider's default model included", () => {
    expect(effortOf(MODELS, "mistral", "mistral-medium-3-5")).toBe("medium_as_high");
    expect(effortOf(MODELS, "anthropic", null)).toBe("native");
    expect(effortOf(MODELS, "mistral", null)).toBe("ignored");
    expect(effortOf(MODELS, "openai", "gpt-5")).toBe("native");
  });
});
