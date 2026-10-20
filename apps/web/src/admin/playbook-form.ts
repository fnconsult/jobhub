import { effortHandling, type AgentModelChoice, type EffortHandling, type ProviderId } from "@jobhub/ai";

/** The model select's value for a Playbook Agent: provider and model; no model is the provider's default one. */
export const agentModelValue = (provider: ProviderId, model: string | null): string => `${provider}|${model ?? ""}`;

/**
 * A Playbook Version as submitted by the Back Office's form (#225), for `CoachingPlaybooks.create` and
 * `save`, which check every value: the model select read back as provider and model. A task Playbook's
 * form may give no effort ("": the model's own) and gives no "when to consult it" (ADR-0026). One that
 * searches the web gives its « Moteur de recherche » select, read back the same way, "" for the
 * configured web-search route; the other forms give none (both "").
 */
export function playbookVersionFromForm(form: FormData): {
  id: string;
  content: string;
  provider: string;
  model: string;
  effort: string;
  consultWhen: string;
  searchProvider: string;
  searchModel: string;
} {
  const text = (field: string) => String(form.get(field) ?? "");
  const [provider = "", model = ""] = text("agentModel").split("|");
  const [searchProvider = "", searchModel = ""] = text("searchModel").split("|");
  return { id: text("id").trim(), content: text("content"), provider, model, effort: text("effort"), consultWhen: text("consultWhen"), searchProvider, searchModel };
}

/** Whether a model the Back Office offers runs outside the EU (its option says so); with no model, the provider's default one. */
export function outsideEu(choices: AgentModelChoice[], provider: ProviderId, model: string | null): boolean {
  const choice = choices.find((each) => each.provider === provider);
  if (!choice) return false;
  return (model === null ? choice.residency : (choice.models.find((each) => each.model === model)?.residency ?? choice.residency)) === "outside_eu";
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
