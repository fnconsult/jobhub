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
import { provenanceLink, SITE_DOMAIN } from "./provenance-link";
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
  /** The call carried the Candidate's identity and went to the identity route under their EU AI Consent (« consentement IA UE »). */
  euAiConsent: z.literal(true).optional(),
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

/** The links the link filter allows (as it gives them back): a web page on a web site, a path to one of their pages on the Candidate's. */
const links = (kind: "web" | "candidate") =>
  z.array(z.string()).transform((stored) => [
    ...new Set(stored.flatMap((link) => provenanceLink(link) ?? []).filter((link) => link.startsWith("/") === (kind === "candidate"))),
  ]);
const site = z.discriminatedUnion("kind", [
  /** A site on the web, by its domain, with the pages read. */
  z.strictObject({ kind: z.literal("web"), domain: z.string().regex(SITE_DOMAIN), links: links("web") }),
  /** The Candidate's own data (Master CV, Profile), with their own pages. */
  z.strictObject({ kind: z.literal("candidate"), links: links("candidate") }),
]);

const provenanceSchema = z.strictObject({
  v: z.literal(1),
  steps: z.array(step),
  sites: z.array(site),
  startedAt: z.iso.datetime(),
  /** From the action's start to its end: the time AI Activity totals, where steps' `ms` are summed per model or Tool. */
  wallMs: count,
});

export type ProvenanceStep = z.output<typeof step>;
export type ProvenanceSite = z.output<typeof site>;
export type Provenance = z.output<typeof provenanceSchema>;

/**
 * What a result saved before Provenance was kept still says of the AI that made it, in its own columns
 * (an AI Coach reply's provider, model and tokens): enough for a partial Provenance.
 */
export interface SavedAiFacts {
  activity: Activity;
  task: string;
  provider: string | null;
  model: string | null;
  /** Input not read from the provider's prompt cache. */
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  /** When the result was saved. */
  at: Date;
}

/**
 * The Provenance stored in a result's jsonb column; null when none was kept or it is not one this version knows.
 * Its sites keep only the links the link filter allows today.
 *
 * With `saved`, a result saved before Provenance was kept (or with one this version cannot read) gets a partial one, read from its own columns on the fly:
 * one AI step with who answered and its tokens, no endpoint, no sites, its times unknown (0); still null when no
 * model was saved either (« modèle non enregistré »).
 */
export function readProvenance(stored: unknown, saved?: SavedAiFacts): Provenance | null {
  const parsed = provenanceSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  return saved ? partialProvenance(saved) : null;
}

function partialProvenance(saved: SavedAiFacts): Provenance | null {
  if (!saved.provider || !saved.model) return null;
  const at = saved.at.toISOString();
  const tokens =
    saved.inputTokens == null || saved.outputTokens == null ? {} : { tokens: { input: saved.inputTokens + (saved.cachedInputTokens ?? 0), output: saved.outputTokens } };
  const step = { kind: "ai", activity: saved.activity, task: saved.task, provider: saved.provider, model: saved.model, ...tokens, ms: 0, at, outcome: "ok", count: 1 };
  try {
    return storableProvenance({ v: 1, steps: [step as ProvenanceStep], sites: [], startedAt: at, wallMs: 0 });
  } catch {
    return null;
  }
}

/**
 * The Provenance as it may be stored: an AI step's provider, endpoint or model whose shape is not one a Provenance
 * keeps is left out (a provider answering with an odd model id), and each site keeps the links the link filter allows.
 */
export function storableProvenance(provenance: Provenance): Provenance {
  const steps = provenance.steps.map((stored) => {
    if (stored.kind !== "ai") return stored;
    const kept = { ...stored };
    if (kept.provider !== undefined && !AI_PROVIDERS.has(kept.provider)) delete kept.provider;
    if (kept.endpoint !== undefined && !identifier(ENDPOINT).safeParse(kept.endpoint).success) delete kept.endpoint;
    if (kept.model !== undefined && !identifier(MODEL).safeParse(kept.model).success) delete kept.model;
    return kept;
  });
  return provenanceSchema.parse({ ...provenance, steps });
}

/**
 * One content's Provenance made of two actions, `later` run after `earlier` (a Job Offer: the search that found it,
 * then its page read; or its reading, then its summary written another day): the steps of both in order, each site
 * once with the links of both, the first start, and the time both took (their wall-clock times summed, never the
 * time between them). Either may be none, made before Provenance was kept; both none is none.
 */
export function joinProvenance(earlier: Provenance | null, later: Provenance | null): Provenance | null {
  if (!earlier || !later) return earlier ?? later;
  const sites = structuredClone(earlier.sites);
  for (const site of later.sites) {
    const same = sites.find((other) => other.kind === site.kind && (other.kind === "candidate" || (site.kind === "web" && other.domain === site.domain)));
    if (same) same.links = [...new Set([...same.links, ...site.links])];
    else sites.push(structuredClone(site));
  }
  return {
    v: 1,
    steps: [...earlier.steps, ...later.steps],
    sites,
    startedAt: earlier.startedAt <= later.startedAt ? earlier.startedAt : later.startedAt,
    wallMs: earlier.wallMs + later.wallMs,
  };
}

/**
 * The Provenance of content Jobbbox's rules made alone, no AI (#336: an ATS Score, an ATS Fix, a Job Digest's
 * Match Scores): one rules step, compute, from `at`, taking `ms` (0: not measured, time unknown), built from the
 * Candidate's own pages `links` (each kept only as the link filter allows).
 */
export function rulesProvenance(rule: ProvenanceRule, run: { at: Date; ms?: number; links?: readonly string[] }): Provenance {
  const at = run.at.toISOString();
  const ms = Math.max(0, Math.round(run.ms ?? 0));
  const links = [...new Set((run.links ?? []).flatMap((link) => provenanceLink(link) ?? []).filter((link) => link.startsWith("/")))];
  return {
    v: 1,
    steps: [{ kind: "rules", activity: "compute", rule, ms, at, outcome: "ok", count: 1 }],
    sites: links.length > 0 ? [{ kind: "candidate", links }] : [],
    startedAt: at,
    wallMs: ms,
  };
}

/** Runs rules, timed: what they work out, and its Provenance (`rulesProvenance`). */
export async function byRules<T>(
  rule: ProvenanceRule,
  run: () => T | Promise<T>,
  options: { now?: () => Date; links?: readonly string[] } = {},
): Promise<{ value: T; provenance: Provenance }> {
  const now = options.now ?? (() => new Date());
  const at = now();
  const value = await run();
  return { value, provenance: rulesProvenance(rule, { at, ms: now().getTime() - at.getTime(), links: options.links }) };
}

/** What a step is before it ends: its Activity and what it runs, never its model (the AI layer picks the route as it sends). */
export type StartedStep = {
  [K in ProvenanceStep["kind"]]: Omit<Extract<ProvenanceStep, { kind: K }>, "ms" | "outcome" | "count" | "provider" | "endpoint" | "model" | "tokens" | "euAiConsent">;
}[ProvenanceStep["kind"]];

/**
 * The live events of an action's steps, the same over every transport (#319 §4): each call starts and ends once,
 * by its `id` within the action, before it is folded into the stored Provenance.
 */
export type ProvenanceEvent = { type: "step_started"; id: number; step: StartedStep } | { type: "step_ended"; id: number; step: ProvenanceStep };

const UNKNOWN_YET = { ms: true, outcome: true, count: true } as const;
const startedStep = z.discriminatedUnion("kind", [
  aiStep.omit({ ...UNKNOWN_YET, provider: true, endpoint: true, model: true, tokens: true, euAiConsent: true }),
  toolStep.omit(UNKNOWN_YET),
  rulesStep.omit(UNKNOWN_YET),
]);
const eventId = z.number().int().positive();
const provenanceEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("step_started"), id: eventId, step: startedStep }),
  z.strictObject({ type: z.literal("step_ended"), id: eventId, step }),
]);

/**
 * A step's event as stored or sent (a Job Search's progress on its row): null when it is not one, or names
 * anything a Provenance never keeps (no field may be a Candidate id, a cost or any text).
 */
export function readProvenanceEvent(stored: unknown): ProvenanceEvent | null {
  const parsed = provenanceEvent.safeParse(stored);
  return parsed.success ? (parsed.data as ProvenanceEvent) : null;
}

/**
 * The Activity whose glyph sits beside a reply (#464): what its last step did. « Réfléchir, puis écrire » when its
 * Provenance was not kept, or holds no step.
 */
export function replyActivity(provenance: Provenance | null): Activity {
  return provenance?.steps.at(-1)?.activity ?? "think_write";
}
