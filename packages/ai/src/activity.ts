/**
 * The Activity of each step of an AI action (CONTEXT.md, ADR-0034): what it is doing, which picks the glyph AI
 * Activity shows while it runs. Fixed here in code, never per Playbook: a Playbook picks the model, not what kind
 * of work a step is.
 *
 *   activityOf({ kind: "ai", task: "cv_parsing" })          the default for an AI task: "read"
 *   activityOf({ kind: "tool", tool: "france-travail" })    the default for a Tool: "search"
 *   activityOf({ kind: "rules", rule: "match_score" })      rules, no AI: "compute"
 *   FEATURE_STEPS.read_job_page                             a feature step's own, over its task's: "read"
 */
import type { Activity, ProvenanceRule, ToolId } from "@jobhub/shared";
import type { AiTask } from "./types";

/** Each AI task's default Activity. */
const TASK_STEPS = {
  job_titles: "think",
  web_search: "web_search",
  cv_parsing: "read",
  writing: "write",
  /** A Job Offer's summary; reading the page is the `read_job_page` feature step. */
  offer_analysis: "think_write",
  scoring: "think",
  coaching: "think_write",
  back_office_assistant: "think_write",
  guardrail: "think",
  eval: "think",
} as const satisfies Record<AiTask, Activity>;

/**
 * Each Tool's default Activity, or why it has none of its own: `by_task` for an AI model or web search, whose
 * step is the AI task it served; `not_a_step` for a Tool no AI action calls (billing, mail, sign-in, places,
 * reference data).
 */
export const TOOL_STEPS = {
  anthropic: "by_task",
  "anthropic-bedrock": "by_task",
  "anthropic-vertex": "by_task",
  mistral: "by_task",
  openai: "by_task",
  perplexity: "by_task",
  brave: "by_task",
  tavily: "by_task",
  "france-travail": "search",
  "fantastic-jobs": "search",
  greenhouse: "search",
  lever: "search",
  ashby: "search",
  apec: "read",
  "job-site": "read",
  "recherche-entreprises": "search",
  lusha: "search",
  kaspr: "search",
  apollo: "search",
  stripe: "not_a_step",
  "brevo-api": "not_a_step",
  "brevo-smtp": "not_a_step",
  google: "not_a_step",
  apple: "not_a_step",
  microsoft: "not_a_step",
  oidc: "not_a_step",
  "geo-api-gouv": "not_a_step",
  "insee-naf": "not_a_step",
  "rome-open-data": "not_a_step",
} as const satisfies Record<ToolId, Activity | "by_task" | "not_a_step">;

/** A Tool that is a step of its own in an AI action. */
export type StepTool = { [T in ToolId]: (typeof TOOL_STEPS)[T] extends Activity ? T : never }[ToolId];

/** Each rule's Activity: rules are no AI. */
const RULE_STEPS = {
  match_score: "compute",
  ats_score: "compute",
  ats_fixes: "compute",
  offer_freshness: "compute",
  offer_dedup: "compute",
} as const satisfies Record<ProvenanceRule, Activity>;

/** The feature steps whose Activity is not their AI task's, each fixed here. */
export const FEATURE_STEPS = {
  /** `offer_analysis` reading a job page into a Job Offer. */
  read_job_page: "read",
  /** `offer_analysis` judging whether a posting is from a recruiting agency, for a Company Dossier. */
  company_dossier_agency_check: "think",
  /** `coaching` choosing which Playbook Agents to consult. */
  coach_choice: "think",
  /** `coaching`: a Playbook Agent advising the AI Coach. */
  playbook_agent: "think",
  /** `writing` translating words for a Tailored CV. */
  tailored_cv_translation: "think",
} as const satisfies Record<string, Activity>;
export type FeatureStep = keyof typeof FEATURE_STEPS;

/** What a step is, by kind: an AI task, a Tool, or rules. */
export type StepSubject = { kind: "ai"; task: AiTask } | { kind: "tool"; tool: StepTool } | { kind: "rules"; rule: ProvenanceRule };

/** The default Activity of a step. */
export function activityOf(step: StepSubject): Activity {
  switch (step.kind) {
    case "ai":
      return TASK_STEPS[step.task];
    case "tool":
      return TOOL_STEPS[step.tool];
    case "rules":
      return RULE_STEPS[step.rule];
  }
}
