/**
 * What AI Activity shows for each element of a Provenance (#318, #320): a Tool's logo only where its owner
 * allowed it in writing (`Tool.logo`), else its name in text; Jobbbox's own glyphs for the rest. Never a
 * third-party favicon.
 *
 *   markOf(site)   👤 the Candidate's data, 🌐 a site (its domain in text)
 *   markOf(step)   « J » Jobbbox's rules; a Tool's or AI provider's logo or name
 *
 * And what a step is called while it runs (#328), beside its Activity's glyph: `stepLabel(step)`, worded by
 * `aiActivity.steps.<label>` in every interface language.
 */
import { ACTIVITIES, type ProvenanceSite, type ProvenanceStep, type StartedStep } from "./provenance";
import { toolById, toolOfUsage, type Tool } from "./tools";

/** Jobbbox's own glyphs. */
export const PROVENANCE_GLYPHS = { candidate: "👤", site: "🌐", rules: "J" } as const;

export interface ProvenanceMark {
  /** A Tool's logo, allowed by its owner. */
  logo?: Tool["logo"];
  glyph?: (typeof PROVENANCE_GLYPHS)[keyof typeof PROVENANCE_GLYPHS];
  /** A proper name or a domain, shown as it is. */
  text?: string;
}

/** What AI Activity shows for a site or a step: nothing for an AI step whose provider is not known (it failed first). */
export function markOf(element: ProvenanceSite | ProvenanceStep): ProvenanceMark {
  switch (element.kind) {
    case "candidate":
      return { glyph: PROVENANCE_GLYPHS.candidate };
    case "web":
      return { glyph: PROVENANCE_GLYPHS.site, text: element.domain };
    case "rules":
      return { glyph: PROVENANCE_GLYPHS.rules };
    case "tool":
      return toolMark(toolById(element.tool));
    case "ai":
      return element.provider ? toolMark(toolOfUsage({ table: "ai_usage", provider: element.provider, endpoint: element.endpoint ?? "" })) : {};
  }
}

function toolMark(tool: Tool | undefined): ProvenanceMark {
  if (!tool) return {};
  return tool.logo ? { logo: tool.logo, text: tool.name } : { text: tool.name };
}

/** What a running step is called: its Activity, or a Guardrail's check. */
export const STEP_LABELS = [...ACTIVITIES, "check"] as const;
export type StepLabel = (typeof STEP_LABELS)[number];

/** What AI Activity calls a step while it runs: its Activity's label, « Vérification » for a Guardrail's check. */
export function stepLabel(step: StartedStep | ProvenanceStep): StepLabel {
  return step.kind === "ai" && step.task === "guardrail" ? "check" : step.activity;
}
