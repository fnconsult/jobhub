/**
 * « En ce moment » (CONTEXT.md, ADR-0086, #806): the top of an Activity, under the Context bar. The Candidate's AI actions
 * under way, this page's then « En cours ailleurs », each with its live glyph, its step under way, the steps it finished,
 * its time so far and its stop icon; a Coach reply with its tool steps (#788). A stopped or failed one stays, in light red
 * with its reason (#367), until the next of its kind takes its place; a finished one leaves, announced as before
 * (AiActivityLive's live region).
 *
 *   enCeMoment(actions, pathname, now)   what the block shows, read from AI Activity's live actions (ai-activity/live)
 *
 * Pure: no state of its own; the component (components/EnCeMoment) reads `useAiActivityLive` and ticks `now`.
 */
import type { Activity, StepLabel } from "@jobhub/shared";
import { isRunning, liveView, type LiveAction, type LiveStep } from "./live";

/** One action under way, or stopped or failed lately, as « En ce moment » shows it. */
export interface NowItem {
  action: LiveAction;
  /** Its glyph: the step under way's Activity; once it ended, the last step's; the brain before its first step. */
  activity: Activity;
  /** The step's label, so a Coach Action that proposes draws its toolbox with a card (#788); none before the first step. */
  label: StepLabel | undefined;
  /** The step the glyph shows, so it morphs into the next one even when the Activity stays the same. */
  step: number | undefined;
  /** It runs (or is being stopped): its glyph moves. */
  live: boolean;
  /** How many of its steps ended, neither stopped nor failed. */
  finished: number;
  /** Its time so far; stopped or failed, its time until it ended. */
  ms: number;
  /** Its tool steps (a Coach reply's Coach Actions, `act`), ended and under way, in order. */
  toolSteps: LiveStep[];
}

export interface EnCeMoment {
  /** The page's actions, in the order they started. */
  here: NowItem[];
  /** « En cours ailleurs »: the others, each with its page (`action.href`). */
  elsewhere: NowItem[];
}

/** The glyph before an action's first step. */
const BEFORE_FIRST_STEP: Activity = "think";

const COACH_ACTION: Activity = "act";

function itemOf(action: LiveAction, now: number): NowItem {
  const shown = action.current ?? action.steps[action.steps.length - 1] ?? null;
  const until = action.endedAt ? Date.parse(action.endedAt) : now;
  return {
    action,
    activity: shown?.activity ?? BEFORE_FIRST_STEP,
    label: shown?.label,
    step: shown?.id,
    live: isRunning(action),
    finished: action.steps.filter((step) => !step.running && step.outcome !== "stopped" && step.outcome !== "failed").length,
    ms: Math.max(0, until - Date.parse(action.startedAt)),
    toolSteps: action.steps.filter((step) => step.activity === COACH_ACTION),
  };
}

/** What « En ce moment » shows at `now` on the page at `pathname`: a finished action is no longer in it. */
export function enCeMoment(actions: readonly LiveAction[], pathname: string, now: number): EnCeMoment {
  const view = liveView(actions, pathname);
  const shown = (action: LiveAction) => action.status !== "done";
  return {
    here: view.here.filter(shown).map((action) => itemOf(action, now)),
    elsewhere: view.elsewhere.filter(shown).map((action) => itemOf(action, now)),
  };
}
