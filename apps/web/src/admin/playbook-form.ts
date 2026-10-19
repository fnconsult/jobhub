import { effortHandling, type AgentModelChoice, type EffortHandling, type ProviderId } from "@jobhub/ai";

/** The model select's value for a Playbook Agent: provider and model; no model is the provider's default one. */
export const agentModelValue = (provider: ProviderId, model: string | null): string => `${provider}|${model ?? ""}`;

/**
 * A Playbook Version as submitted by the Back Office's form (#225), for `CoachingPlaybooks.create` and
 * `save`, which check every value: the model select read back as provider and model. A task Playbook's
 * form may give no effort ("": the model's own) and gives no "when to consult it" (ADR-0026).
 */
export function playbookVersionFromForm(form: FormData): { id: string; content: string; provider: string; model: string; effort: string; consultWhen: string } {
  const text = (field: string) => String(form.get(field) ?? "");
  const [provider = "", model = ""] = text("agentModel").split("|");
  return { id: text("id").trim(), content: text("content"), provider, model, effort: text("effort"), consultWhen: text("consultWhen") };
}

/** How a Playbook Agent's model takes its effort; with no model, the provider's default one. */
export function effortOf(choices: AgentModelChoice[], provider: ProviderId, model: string | null): EffortHandling {
  const named = model ?? choices.find((choice) => choice.provider === provider)?.defaultModel;
  return named ? effortHandling(provider, named) : "ignored";
}
