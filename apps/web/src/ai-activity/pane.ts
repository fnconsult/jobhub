/**
 * AI Activity's « Cette page » pane (CONTEXT.md, #314, #332): what produced what a Candidate page shows, read from each
 * element's stored Provenance, summed for the page and listed per element.
 *
 *   activityElement("job_offer", provenance, { name, at })   one element of the page, as the pane shows it
 *   aiActivityPane(elements)                                 the pane: Modèles, Sources, Outils, Par élément, the Total and the closed button's summary
 *
 * An element is all that crosses to the browser: its kind, a Job Offer's title, its date, and what served it, the models
 * named for people (each raw id kept for the tooltip), where they ran, tokens and time, its Tools and Provenance sites.
 * Never a cost, prompt, AI task, Playbook Agent, Outcome, Back Office setting or internal id: none is read from the Provenance.
 * An element whose Provenance was not kept (made before, or its slice not landed) is « modèle non enregistré », out of every total.
 *
 * Each model's time and each Tool's are its calls' durations summed; the Total's time is wall-clock, each element's start to end summed.
 * A time of 0 is one not kept (a Coach reply saved before Provenance), so not known (null).
 */
import { describeModel, markOf, residencyOf, whereItRan, type Provenance, type ProvenanceSite, type Translated } from "@jobhub/shared";

/** What a page shows that AI may have produced, each the content a Provenance is kept with. */
export const ELEMENT_KINDS = ["job_offer", "coach_reply", "job_search", "job_digest", "tailored_cv", "tailored_documents", "company_dossier", "action_card"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export interface ActivityModel {
  /** Its display name, e.g. « Claude Opus 5 »; an unknown model raw. */
  name: string;
  /** The ids that served, as the provider names them: the tooltip, and monospace in Par élément. */
  ids: string[];
  /** Where it ran, e.g. « AWS Bedrock · UE (Stockholm) »; null when the endpoint was not kept. */
  where: Translated | null;
  /** It went to the identity route under the Candidate's EU AI Consent: « consentement IA UE ». */
  euAiConsent: boolean;
  /** It ran outside the EU: « hors UE ». */
  outsideEu: boolean;
  /** Input and output; null when none were kept. */
  tokens: number | null;
  /** Its calls' durations summed; null when not kept. */
  ms: number | null;
}

export interface ActivityTool {
  /** The Tool's name; null for Jobbbox's own rules (« J »). */
  name: string | null;
  /** Its logo, only where its owner allowed it in writing. */
  logo?: string;
  /** Its calls' durations summed; null when not kept. */
  ms: number | null;
}

export interface ActivityElement {
  kind: ElementKind;
  /** A Job Offer's title. */
  name?: string;
  /** When its action started, else when it was made; null when not known. */
  at: string | null;
  /** What served it; null: « modèle non enregistré », out of the totals. */
  served: {
    models: ActivityModel[];
    tools: ActivityTool[];
    sites: ProvenanceSite[];
    tokens: number | null;
    /** Wall-clock, from its start to its end. */
    ms: number | null;
  } | null;
}

export interface AiActivityPane {
  models: ActivityModel[];
  /** The page's tokens, and its elements' wall-clock times summed. */
  total: { tokens: number | null; ms: number | null };
  sites: ProvenanceSite[];
  /** `usedBy`: the elements that used it, by their place in `elements`. */
  tools: (ActivityTool & { usedBy: number[] })[];
  elements: ActivityElement[];
  /** What the closed button says, « 3 modèles · 10,9k tokens · 21,5 s »; null on a page with no recorded AI content (no words). */
  summary: { models: number; tokens: number | null; ms: number | null } | null;
}

const add = (sum: number | null, value: number | null): number | null => (value === null ? sum : (sum ?? 0) + value);
const known = (ms: number): number | null => (ms > 0 ? ms : null);
const sameModel = (one: ActivityModel, other: ActivityModel) =>
  one.name === other.name && one.euAiConsent === other.euAiConsent && (one.where?.en ?? null) === (other.where?.en ?? null);

function addModel(models: ActivityModel[], model: ActivityModel): void {
  const same = models.find((other) => sameModel(other, model));
  if (!same) {
    models.push({ ...model, ids: [...model.ids] });
    return;
  }
  same.ids = [...new Set([...same.ids, ...model.ids])];
  same.tokens = add(same.tokens, model.tokens);
  same.ms = add(same.ms, model.ms);
}

function addTool(tools: ActivityTool[], tool: ActivityTool): ActivityTool {
  const same = tools.find((other) => other.name === tool.name);
  if (!same) {
    const kept = { ...tool };
    tools.push(kept);
    return kept;
  }
  same.ms = add(same.ms, tool.ms);
  return same;
}

function addSite(sites: ProvenanceSite[], site: ProvenanceSite): void {
  const same = sites.find((other) => other.kind === site.kind && (other.kind === "candidate" || (site.kind === "web" && other.domain === site.domain)));
  if (same) same.links = [...new Set([...same.links, ...site.links])];
  else sites.push(structuredClone(site));
}

/** One element of the page, as the pane shows it: what served it, read from its Provenance (null when none was kept). */
export function activityElement(kind: ElementKind, provenance: Provenance | null, made: { name?: string; at?: string | null } = {}): ActivityElement {
  const named = made.name ? { name: made.name } : {};
  if (!provenance) return { kind, ...named, at: made.at ?? null, served: null };
  const models: ActivityModel[] = [];
  const tools: ActivityTool[] = [];
  const sites: ProvenanceSite[] = [];
  let tokens: number | null = null;
  for (const step of provenance.steps) {
    if (step.kind === "ai") {
      const stepTokens = step.tokens ? step.tokens.input + step.tokens.output : null;
      tokens = add(tokens, stepTokens);
      if (!step.model) continue;
      addModel(models, {
        name: describeModel(step.model, step.provider).name,
        ids: [step.model],
        where: step.endpoint ? whereItRan(step.endpoint) : null,
        euAiConsent: step.euAiConsent === true,
        outsideEu: step.endpoint ? residencyOf(step.endpoint) === "outside_eu" : false,
        tokens: stepTokens,
        ms: known(step.ms),
      });
      continue;
    }
    const mark = markOf(step);
    if (step.kind === "tool" && !mark.text) continue;
    addTool(tools, { name: step.kind === "rules" ? null : mark.text!, ...(mark.logo ? { logo: mark.logo } : {}), ms: known(step.ms) });
  }
  for (const site of provenance.sites) addSite(sites, site);
  return { kind, ...named, at: provenance.startedAt, served: { models, tools, sites, tokens, ms: known(provenance.wallMs) } };
}

/** The pane for the page's elements: each model, Tool and Provenance site once with its sums, the Total, and the closed button's summary. */
export function aiActivityPane(elements: ActivityElement[]): AiActivityPane {
  const models: ActivityModel[] = [];
  const tools: AiActivityPane["tools"] = [];
  const sites: ProvenanceSite[] = [];
  let tokens: number | null = null;
  let ms: number | null = null;
  let recorded = false;
  elements.forEach((element, index) => {
    if (!element.served) return;
    recorded = true;
    tokens = add(tokens, element.served.tokens);
    ms = add(ms, element.served.ms);
    for (const model of element.served.models) addModel(models, model);
    for (const tool of element.served.tools) {
      const kept = addTool(tools, { ...tool, usedBy: [] }) as AiActivityPane["tools"][number];
      if (!kept.usedBy.includes(index)) kept.usedBy.push(index);
    }
    for (const site of element.served.sites) addSite(sites, site);
  });
  return { models, total: { tokens, ms }, sites, tools, elements, summary: recorded ? { models: models.length, tokens, ms } : null };
}
