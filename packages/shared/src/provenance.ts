/**
 * Provenance (CONTEXT.md, ADR-0034): what served one piece of content a Candidate sees, fixed when it is
 * made and kept with it in a nullable `provenance` jsonb column, null meaning « modèle non enregistré ».
 *
 *   readProvenance(row.provenance)   the stored Provenance, or null (none kept, or not one this version knows)
 *
 * It holds its steps (each with its Activity, AI task, Tool or rules, and for an AI step the provider, the
 * endpoint with its region and the model that served, its tokens), its Provenance sites with their links,
 * and the action's start and wall-clock time. Never a Candidate id, a cost or any text: no field is one,
 * a stored object with any other field is refused, and every string is an identifier, a domain, a link or
 * a date, so none can carry a sentence or an id.
 */
import { z } from "zod";
import { OUTCOMES } from "./failure-reasons";
import { TOOLS, type AiUsageProvider, type ToolId } from "./tools";

/**
 * What one step of an AI action is doing: it picks the glyph AI Activity shows while the step runs.
 * `compute` is rules, no AI.
 */
export const ACTIVITIES = ["think", "think_write", "write", "search", "web_search", "read", "compute"] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** The rules (no AI) a step can apply: Match Score, ATS Score, ATS Fixes, and a Job Search's freshness and duplicate checks. */
export const PROVENANCE_RULES = ["match_score", "ats_score", "ats_fixes", "offer_freshness", "offer_dedup"] as const;
export type ProvenanceRule = (typeof PROVENANCE_RULES)[number];

/** How a step ended: an AI call's Outcome, or `stopped` when the Candidate stopped it. */
export const STEP_OUTCOMES = [...OUTCOMES, "stopped"] as const;
export type StepOutcome = (typeof STEP_OUTCOMES)[number];

const TOOL_IDS: ReadonlySet<string> = new Set(TOOLS.map((tool) => tool.id));
const AI_PROVIDERS: ReadonlySet<string> = new Set(TOOLS.flatMap((tool) => (tool.usage?.table === "ai_usage" ? [tool.usage.provider] : [])));

/** An AI task's id, e.g. `cv_parsing`: lower-case letters and underscores. */
const TASK = /^[a-z][a-z_]{1,39}$/;
/** A model as its provider names it, e.g. `anthropic.claude-opus-5`, `claude-opus-5@20260101`, `openai/gpt-6-luna`: no space. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;
/** An endpoint with its region, e.g. `bedrock eu-north-1`, `api.mistral.ai`: a host or a kind and a region. */
const ENDPOINT = /^[a-z0-9][a-z0-9.-]{0,79}( [a-z0-9-]{1,40})?$/;
/** A site's domain, e.g. `apec.fr`. */
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** An id's shape: a value that has it is never kept, whatever field it is in. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const identifier = (shape: RegExp) => z.string().regex(shape).refine((value) => !UUID.test(value));
const count = z.number().int().nonnegative();

const stepBase = {
  activity: z.enum(ACTIVITIES),
  /** This call's duration, or the sum of the calls folded into the step. */
  ms: count,
  /** When it started, or the first of the calls folded into it. */
  at: z.iso.datetime(),
  outcome: z.enum(STEP_OUTCOMES),
  /** How many calls were folded into the step (e.g. 14 page reads of one site). */
  count: z.number().int().positive(),
};

const aiStep = z.strictObject({
  kind: z.literal("ai"),
  ...stepBase,
  task: identifier(TASK),
  /** The provider, endpoint and model that served; absent for a call that failed before one answered. */
  provider: z.custom<AiUsageProvider>((value) => typeof value === "string" && AI_PROVIDERS.has(value)).optional(),
  endpoint: identifier(ENDPOINT).optional(),
  model: identifier(MODEL).optional(),
  /** Input counts the cached input too. */
  tokens: z.strictObject({ input: count, output: count }).optional(),
});
const toolStep = z.strictObject({
  kind: z.literal("tool"),
  ...stepBase,
  tool: z.custom<ToolId>((value) => typeof value === "string" && TOOL_IDS.has(value)),
});
const rulesStep = z.strictObject({
  kind: z.literal("rules"),
  ...stepBase,
  rule: z.enum(PROVENANCE_RULES),
});
const step = z.discriminatedUnion("kind", [aiStep, toolStep, rulesStep]);

const link = z.string().max(2000);
const site = z.discriminatedUnion("kind", [
  /** A site on the web, by its domain, with the pages read. */
  z.strictObject({ kind: z.literal("web"), domain: z.string().regex(DOMAIN), links: z.array(link) }),
  /** The Candidate's own data (Master CV, Profile), with their own pages. */
  z.strictObject({ kind: z.literal("candidate"), links: z.array(link) }),
]);

const provenanceSchema = z.strictObject({
  v: z.literal(1),
  steps: z.array(step),
  sites: z.array(site),
  startedAt: z.iso.datetime(),
  /** From the action's start to its end: the time AI Activity totals, where steps' `ms` are summed per model or Tool. */
  wallMs: count,
});

export type ProvenanceStep = z.infer<typeof step>;
export type ProvenanceSite = z.infer<typeof site>;
export type Provenance = z.infer<typeof provenanceSchema>;

/** The Provenance stored in a result's jsonb column; null when none was kept or it is not one this version knows. */
export function readProvenance(stored: unknown): Provenance | null {
  const parsed = provenanceSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}
