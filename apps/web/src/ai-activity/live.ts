/**
 * AI Activity's live actions (CONTEXT.md « AI Activity », ADR-0034, #333): the Candidate's AI actions running now, each
 * with its steps as they land, fed by one event shape whatever the transport: a Coach reply's, a Tailored CV's or a
 * Tailored Document's steps streamed on its own POST (#334), a Job Search's Run progress polled by the page.
 *
 *   nextLive(actions, change)     the actions after a change: an action started, a step's event, a Stop asked, an end,
 *                                 or the Job Searches the page's poll brought
 *   liveView(actions, pathname)   what AI Activity shows: the action under way for the closed button, those of this page,
 *                                 and those « En cours ailleurs »
 *
 * Pure: the provider (components/AiActivity) keeps the state and the Stops.
 */
import { describeModel, stepLabel, toolById, type Activity, type ProvenanceEvent, type ProvenanceStep, type StepLabel, type StepOutcome } from "@jobhub/shared";
import type { JobSearchNotification, RunningJobSearch } from "../job-searches";
import { routes } from "../routes";

export type LiveKind = "job_search" | RequestKind;

/** An action run in the page's own request, its steps streamed on it, the request's abort its Stop (#333, #334). */
export type RequestKind = "coach_reply" | "tailored_cv" | "tailored_documents";

/** One step of a live action: running, or ended with what it took. */
export interface LiveStep {
  /** Its id within the action, as the events give it. */
  id: number;
  activity: Activity;
  label: StepLabel;
  running: boolean;
  outcome: StepOutcome | null;
  /** The model that served an AI step, named for people (« Mistral Large »); null until it ends, or for a Tool or the rules. */
  model: string | null;
  /** A Tool step's Tool by name; null for an AI step or the rules (« Règles Jobbbox »). */
  tool: string | null;
  /** An ended AI step's tokens in and out; null otherwise. */
  tokens: number | null;
  /** An ended step's time; null while it runs. */
  ms: number | null;
  /** When it started (ISO): its hour in the pane (« 10:40 »). */
  at: string;
  /** An ended step's result: how many calls it folded (« 12 pages lues »); null while it runs. */
  count: number | null;
}

export interface LiveAction {
  /** `job_search:<its id>`, or `<its kind>:<n>` for an action run in the page's request. */
  key: string;
  kind: LiveKind;
  /** The page it runs for: the Job Search's, or the page the action was asked from. */
  href: string;
  /** A Job Search's Profile; null for a Coach reply. */
  name: string | null;
  startedAt: string;
  /** Done: a Job Search's « ✓ Dernière recherche · 16 s », until its notification is dismissed. */
  status: "running" | "stopping" | "done" | "stopped" | "failed";
  steps: LiveStep[];
  /** The step under way, the latest started; null before the first or once all ended. */
  current: LiveStep | null;
  /** Its ended steps' tokens; null while none spent any. */
  tokens: number | null;
  /** When it was done, stopped or failed; null while it runs. */
  endedAt: string | null;
  /** This browser saw it start (a Coach reply sent here, a Job Search first polled within moments of its start): announced as starting. */
  seenFromStart: boolean;
  /** Why it failed, as an i18n key of its Failure Reason (null: not known), and during which step (null: none known). */
  failure: { reason: string | null; step: StepLabel | null } | null;
}

/** A Job Search that stopped searching, as the poll's notifications tell it. */
export type LiveEnded = Pick<JobSearchNotification, "jobSearchId" | "outcome">;

export type LiveChange =
  | { type: "started"; key: string; kind: LiveKind; href: string; at: string }
  | { type: "step"; key: string; event: ProvenanceEvent }
  /** The Candidate asked it to stop: it says so until it ends. */
  | { type: "stopping"; key: string }
  /**
   * It ended: done (an action run in the page's request leaves, what it made joins the page's elements with its own
   * Provenance line; a Job Search stays done), stopped, or failed with its Failure Reason's i18n key and the step it failed in.
   */
  | { type: "ended"; key: string; outcome: "done" | "stopped" | "failed"; at: string; reason?: string | null; step?: StepLabel | null }
  /** What the page's poll brought, `at` that time: the Candidate's Job Searches searching, with their Run progress, and those that stopped searching. */
  | { type: "job_searches"; running: readonly RunningJobSearch[]; ended: readonly LiveEnded[]; at: string };

/** A Job Search first polled within this time of its start was seen from its start. */
const JUST_STARTED_MS = 15_000;

/** The last of `items` that `matches` (the web app's target has no Array.prototype.findLast). */
function lastOf<T>(items: readonly T[], matches: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index--) if (matches(items[index]!)) return items[index];
  return undefined;
}

const withSums = (action: LiveAction): LiveAction => ({
  ...action,
  current: lastOf(action.steps, (one) => one.running) ?? null,
  tokens: action.steps.reduce<number | null>((sum, one) => (one.tokens === null ? sum : (sum ?? 0) + one.tokens), null),
});

function stepOf(event: ProvenanceEvent): LiveStep {
  const step = event.step;
  const started = { id: event.id, activity: step.activity, label: stepLabel(step), model: null, tool: step.kind === "tool" ? (toolById(step.tool)?.name ?? null) : null, tokens: null, ms: null, at: step.at, count: null };
  if (event.type === "step_started") return { ...started, running: true, outcome: null };
  return { ...started, running: false, outcome: event.step.outcome, ms: event.step.ms, count: event.step.count, ...served(event.step) };
}

/** What served an ended AI step: its model for people, its tokens. */
function served(step: ProvenanceStep): Pick<LiveStep, "model" | "tokens"> {
  if (step.kind !== "ai") return { model: null, tokens: null };
  return { model: step.model ? describeModel(step.model, step.provider).name : null, tokens: step.tokens ? step.tokens.input + step.tokens.output : null };
}

function withEvent(action: LiveAction, event: ProvenanceEvent): LiveAction {
  const index = action.steps.findIndex((one) => one.id === event.id);
  const steps = index >= 0 ? action.steps.map((one, at) => (at === index ? stepOf(event) : one)) : [...action.steps, stepOf(event)];
  return withSums({ ...action, steps });
}

/** It runs, or is being stopped. */
export const isRunning = (action: LiveAction) => action.status === "running" || action.status === "stopping";
const running = isRunning;

/**
 * It ended: done, the steps still running end with it (how, the poll did not say); stopped or failed, they end so, and a
 * failure names the step it failed in.
 */
function ended(action: LiveAction, change: Extract<LiveChange, { type: "ended" }>): LiveAction {
  const outcome: Extract<StepOutcome, "stopped" | "failed"> | null = change.outcome === "done" ? null : change.outcome;
  const failedIn = change.step ?? lastOf(action.steps, (one) => one.outcome === "failed")?.label ?? action.current?.label ?? null;
  const steps = action.steps.map((one) => (one.running ? { ...one, running: false, outcome } : one));
  return {
    ...withSums({ ...action, steps }),
    status: change.outcome,
    endedAt: change.at,
    failure: outcome === "failed" ? { reason: change.reason ?? null, step: failedIn } : null,
  };
}

const jobSearchKey = (jobSearchId: string) => `job_search:${jobSearchId}`;

function started(change: { key: string; kind: LiveKind; href: string; at: string; name?: string; seenFromStart?: boolean }): LiveAction {
  const { key, kind, href, at } = change;
  return { key, kind, href, name: change.name ?? null, startedAt: at, status: "running", steps: [], current: null, tokens: null, endedAt: null, seenFromStart: change.seenFromStart ?? true, failure: null };
}

/**
 * The Job Searches as the poll tells them: each searching one with the steps written so far, the one asked to stop still
 * saying so; one seen searching that ended, done, stopped or failed; one dismissed or never seen searching, nowhere.
 */
function jobSearches(actions: readonly LiveAction[], poll: Extract<LiveChange, { type: "job_searches" }>): LiveAction[] {
  const searching = new Map(poll.running.map((search) => [jobSearchKey(search.jobSearchId), search]));
  const endings = new Map(poll.ended.map((search) => [jobSearchKey(search.jobSearchId), search.outcome]));
  const kept = actions.flatMap((action): LiveAction[] => {
    if (action.kind !== "job_search" || searching.has(action.key)) return [action];
    const outcome = endings.get(action.key);
    if (!outcome) return [];
    if (!running(action)) return [action];
    // Done, its Provenance's steps, folded, take the place of the live ones: the last poll may have left one running.
    if (outcome.status === "done") {
      const steps = outcome.steps.map((step, index) => stepOf({ type: "step_ended", id: index + 1, step }));
      return [ended(steps.length > 0 ? withSums({ ...action, steps }) : action, { type: "ended", key: action.key, outcome: "done", at: outcome.at })];
    }
    return [ended(action, { type: "ended", key: action.key, outcome: outcome.status, at: outcome.at, ...(outcome.status === "failed" ? { reason: `jobSearch.failureReasons.${outcome.failure}`, step: outcome.step } : {}) })];
  });
  const known = new Set(kept.map((action) => action.key));
  for (const search of poll.running) {
    const key = jobSearchKey(search.jobSearchId);
    if (known.has(key)) continue;
    const seenFromStart = Date.parse(poll.at) - Date.parse(search.startedAt) < JUST_STARTED_MS;
    kept.push(started({ key, kind: "job_search", href: routes.jobSearch(search.jobSearchId), at: search.startedAt, name: search.profile.name, seenFromStart }));
  }
  return kept.map((action) => {
    const search = searching.get(action.key);
    if (!search) return action;
    return withSums({ ...action, steps: search.steps.map(stepOf) });
  });
}

export function nextLive(actions: readonly LiveAction[], change: LiveChange): LiveAction[] {
  switch (change.type) {
    case "started": {
      // A new action run in the page's request takes the place of the one of its kind stopped or failed before it.
      const kept = actions.filter((action) => action.key !== change.key && (change.kind === "job_search" || action.kind !== change.kind || running(action)));
      return [...kept, started(change)];
    }
    case "step":
      return actions.map((action) => (action.key === change.key && running(action) ? withEvent(action, change.event) : action));
    case "stopping":
      return actions.map((action) => (action.key === change.key && action.status === "running" ? { ...action, status: "stopping" } : action));
    case "ended":
      return actions.flatMap((action) => {
        if (action.key !== change.key) return [action];
        // An action run in the page's request leaves once done: what it made shows (a Coach reply, a Tailored CV, a Cover
        // Letter…), with its Provenance line, and joins the page's elements.
        if (change.outcome === "done" && action.kind !== "job_search") return [];
        return [running(action) ? ended(action, change) : action];
      });
    case "job_searches":
      return jobSearches(actions, change);
  }
}

export interface LiveView {
  /** What the closed button shows: the latest action still running (or being stopped); null when none is. */
  underWay: LiveAction | null;
  /** The actions run for the page in view, in the order they started. */
  here: LiveAction[];
  /** The others: « En cours ailleurs », each with a link to its page. */
  elsewhere: LiveAction[];
}

export function liveView(actions: readonly LiveAction[], pathname: string): LiveView {
  return {
    underWay: lastOf(actions, running) ?? null,
    here: actions.filter((action) => action.href === pathname),
    elsewhere: actions.filter((action) => action.href !== pathname),
  };
}
