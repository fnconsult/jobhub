/**
 * The Activité entries of a Candidate page (CONTEXT.md « Activité entry », ADR-0086, #807): one line of its Activity's
 * history each, newest first, linked to each other. Pure: given what the page's loaders read, it reads nothing itself.
 *
 *   activityEntries({ page, elements, replies, versions })   the page's entries, the newest first
 *
 * An entry is one of three things: an AI Activity element with its Provenance (`elements`: a Job Search, a Job Offer's
 * reading, an ATS Score…), an AI Coach reply of the page's Coach Conversation (`replies`), a Master CV Version (`versions`,
 * by hand or from an applied Action Card), or an applied Action Card as the change it made (a reply's `cards`). It says
 * what it is about (its object's page and name), where it came from, how it ended, its steps, sites, Tools and models
 * from its Provenance, and its cost: the Plan Quota it used, its tokens, or that it was made without AI. Never a cost in
 * euros, a prompt, an AI task, an Outcome, a person's name or an internal id (ADR-0034): an object a Coach Action saw is
 * named from `seenNames` only.
 *
 * Its links: `messageId`, the message of the conversation it came from (« Voir dans la conversation »), and `after`, the
 * `key` of the entry that caused it (« suite de »): a reply, then the Master CV Version its card created, then that
 * version's ATS Score; a reply, then the change its card applied; a Job Search, then a Job Offer it found.
 */
import type { Provenance, ProvenanceSite, ProvenanceStep, StepLabel, WeeklyQuota } from "@jobhub/shared";
import { describeModel, markOf, stepLabel } from "@jobhub/shared";
import { activityElement, type ActionEnded, type ActivityModel, type ActivityTool, type ElementEnd, type ElementKind } from "./pane";

/**
 * Which page the entries are for, and so what counts (ADR-0086): a Profile's page, its object with its Master CV Versions
 * and ATS Scores; a Job Search's, its run and the Job Offers read from it; any other page, what it shows. Every page has
 * the replies of its Coach Conversation and the changes their cards applied.
 */
export type PageScope = "profile" | "job_search" | "any";

/**
 * Content the page shows that AI may have produced, as its loader read it: its Provenance (null: « modèle non
 * enregistré »), when it was made if not from its Provenance, its name and page. `after`: the place in `elements` of the
 * one that caused it (a Job Offer: the Job Search that found it). `scored`: an ATS Score's Master CV Version.
 */
export interface PageElement {
  kind: ElementKind;
  provenance: Provenance | null;
  at?: Date | string | null;
  name?: string;
  href?: string;
  /** Without a Provenance, the sites it is known to be built from (#335). */
  sites?: readonly ProvenanceSite[];
  /** How its action ended, known besides its Provenance (a Job Search's status). */
  ended?: ActionEnded;
  after?: number;
  scored?: number;
  /** What it gave, as the page knows it: a Job Search's Job Offers kept, an ATS Score's score. */
  result?: { offers?: number; score?: number };
}

/** The kinds of entry: an AI Activity element's, a Master CV Version saved without AI, and an applied card's change. */
export type EntryKind = ElementKind | "master_cv_version" | "change";

/**
 * Where it came from: the Candidate (they launched, opened or saved it), their question (an AI Coach reply), the AI
 * Coach's proposal they applied, or Jobbbox on its own (an ATS Score computed after a save, a Job Digest sent).
 */
export type EntryOrigin = "candidate" | "question" | "coach_proposal" | "jobbbox";

/** One step, as its entry shows it: its label, the Tool or model by its name for people, how many calls it folds, their time. */
export interface EntryStep {
  label: StepLabel;
  /** The Tool's name; null for an AI step and Jobbbox's rules. */
  tool: string | null;
  /** The model's display name, on an AI step that kept one. */
  model: string | null;
  count: number;
  /** Its calls' durations summed; null when not kept. */
  ms: number | null;
  /** Input and output, on an AI step that kept them. */
  tokens: number | null;
}

/**
 * Its cost, never in euros: the Plan Quota it used (Votre consommation counts the week's use), its tokens (an AI Coach
 * reply's, all its calls summed; `partial` for one saved before #791, whose Provenance holds its last call only), or that
 * it was made without AI.
 */
export interface EntryCost {
  quota: WeeklyQuota | null;
  tokens: { count: number; calls: number | null; partial: boolean } | null;
  noAi: boolean;
}

export interface EntryResult {
  end: ElementEnd;
  offers?: number;
  score?: number;
}

export interface ActivityEntry {
  /** Its place among the page's entries, made of what it is (never an internal id): what `after` points at. */
  key: string;
  kind: EntryKind;
  /** When it started, else when it was made; null when not known. */
  at: string | null;
  /** Its object: its page and its name, each null when it has none. */
  object: { href: string | null; label: string | null };
  origin: EntryOrigin;
  result: EntryResult;
  steps: EntryStep[];
  sites: ProvenanceSite[];
  tools: ActivityTool[];
  models: ActivityModel[];
  cost: EntryCost;
  /** The entry that caused it (« suite de »), by its key. */
  after?: string;
}

export interface ActivityInput {
  page: PageScope;
  elements?: readonly PageElement[];
}

/** The element kinds each page counts; any other page counts every one it is given. */
const SCOPED: Record<Exclude<PageScope, "any">, ReadonlySet<ElementKind>> = {
  profile: new Set(["master_cv", "ats_score", "action_card"]),
  job_search: new Set(["job_search", "job_offer"]),
};

/** The Plan Quota each kind of element uses. */
const QUOTA: Partial<Record<ElementKind, WeeklyQuota>> = { job_search: "jobSearches", ats_score: "atsScores" };

/** Made by Jobbbox on its own, not by the Candidate's own action. */
const BY_JOBBBOX: ReadonlySet<ElementKind> = new Set(["ats_score", "job_digest", "action_card"]);

const iso = (at: Date | string | null | undefined): string | null => (at == null ? null : typeof at === "string" ? at : at.toISOString());
const known = (ms: number): number | null => (ms > 0 ? ms : null);
const tokensOf = (step: ProvenanceStep): number | null => (step.kind === "ai" && step.tokens ? step.tokens.input + step.tokens.output : null);
const add = (sum: number | null, value: number | null): number | null => (value === null ? sum : (sum ?? 0) + value);

/** A step as shown: steps alike (same label, Tool or model) fold into the first, their counts, times and tokens summed. */
function stepsOf(provenance: Provenance | null): EntryStep[] {
  const steps: (EntryStep & { same: string })[] = [];
  for (const step of provenance?.steps ?? []) {
    const label = stepLabel(step);
    const tool = step.kind === "tool" ? (markOf(step).text ?? null) : null;
    const model = step.kind === "ai" && step.model ? describeModel(step.model, step.provider).name : null;
    const same = JSON.stringify([label, step.kind, tool, model]);
    const shown = steps.find((each) => each.same === same);
    if (shown) {
      shown.count += step.count;
      shown.ms = add(shown.ms, known(step.ms));
      shown.tokens = add(shown.tokens, tokensOf(step));
      continue;
    }
    steps.push({ same, label, tool, model, count: step.count, ms: known(step.ms), tokens: tokensOf(step) });
  }
  return steps.map(({ same: _same, ...step }) => step);
}

/** Whether no AI made it: a Provenance with no AI step (Jobbbox's rules, a Coach Action's read). */
const withoutAi = (provenance: Provenance | null): boolean => provenance !== null && !provenance.steps.some((step) => step.kind === "ai");

/** An entry as built, with what sorting and linking need besides. */
type Built = ActivityEntry & { cause?: Cause };
/** What caused an entry, before it is found among the entries: an element by its place. */
type Cause = { element: number };

function elementEntry(given: PageElement): Built {
  const element = activityElement(given.kind, given.provenance, { ...(given.name ? { name: given.name } : {}), at: iso(given.at), ...(given.sites ? { sites: given.sites } : {}), ...(given.ended ? { ended: given.ended } : {}) });
  const served = element.served;
  const tokens = served?.tokens ?? null;
  return {
    key: "",
    kind: given.kind,
    at: element.at,
    object: { href: given.href ?? null, label: given.name ?? null },
    origin: BY_JOBBBOX.has(given.kind) ? "jobbbox" : "candidate",
    result: { end: element.end, ...given.result },
    steps: stepsOf(given.provenance),
    sites: served?.sites ?? element.sites ?? [],
    tools: served?.tools ?? [],
    models: served?.models ?? [],
    cost: { quota: QUOTA[given.kind] ?? null, tokens: tokens === null ? null : { count: tokens, calls: null, partial: false }, noAi: withoutAi(given.provenance) },
    ...(given.after !== undefined ? { cause: { element: given.after } } : {}),
  };
}

/** The page's Activité entries, the newest first. */
export function activityEntries(input: ActivityInput): ActivityEntry[] {
  const scoped = input.page === "any" ? null : SCOPED[input.page];
  const byElement = new Map<number, Built>();
  const built: Built[] = [];
  (input.elements ?? []).forEach((given, index) => {
    if (scoped && !scoped.has(given.kind)) return;
    const entry = elementEntry(given);
    byElement.set(index, entry);
    built.push(entry);
  });
  keyed(built);
  for (const entry of built) {
    const cause = entry.cause ? byElement.get(entry.cause.element) : undefined;
    if (cause) entry.after = cause.key;
  }
  return newestFirst(built).map(({ cause: _cause, ...entry }) => entry);
}

/** Gives each entry its key: its kind and when, numbered when two are alike. */
function keyed(entries: Built[]): void {
  const taken = new Map<string, number>();
  for (const entry of entries) {
    const base = `${entry.kind}:${entry.at ?? "?"}`;
    const n = taken.get(base) ?? 0;
    taken.set(base, n + 1);
    entry.key = n === 0 ? base : `${base}#${n + 1}`;
  }
}

/** The newest first; one not dated last. */
function newestFirst(entries: Built[]): Built[] {
  return [...entries].sort((one, other) => (other.at ?? "").localeCompare(one.at ?? ""));
}
