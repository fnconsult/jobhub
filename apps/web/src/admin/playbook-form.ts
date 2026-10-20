import { effortHandling, type AgentModelChoice, type EffortHandling, type ProviderId } from "@jobhub/ai";

/** The model select's value for a Playbook Agent: provider and model; no model is the provider's default one. */
export const agentModelValue = (provider: ProviderId, model: string | null): string => `${provider}|${model ?? ""}`;

/**
 * A Playbook Version as submitted by the Back Office's form (#225), for `CoachingPlaybooks.create` and
 * `save`, which check every value: the model select read back as provider and model.
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

/** An Eval Case as submitted by the Back Office's form (#231), for `Evals.addCase` and `saveCase`, which check every value. */
export function evalCaseFromForm(form: FormData): { title: string; context: string; message: string; inViewKind: string; inViewText: string; criteria: string } {
  const text = (field: string) => String(form.get(field) ?? "");
  return { title: text("title"), context: text("context"), message: text("message"), inViewKind: text("inViewKind"), inViewText: text("inViewText"), criteria: text("criteria") };
}

/**
 * What an Eval Run plays, as submitted (#231), for `Evals.runPlaybook`, which checks every value: the version, and
 * only the Playbook Agent's model and effort chosen, an empty choice keeping the version's own.
 */
export function evalRunFromForm(form: FormData): { version: number; provider?: string; model?: string; effort?: string } {
  const text = (field: string) => String(form.get(field) ?? "");
  const [provider = "", model = ""] = text("agentModel").split("|");
  return { version: Number(text("version")), ...(provider ? { provider, model } : {}), ...(text("effort") ? { effort: text("effort") } : {}) };
}
