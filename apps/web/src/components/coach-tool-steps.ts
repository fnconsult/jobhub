/**
 * What a Coach Conversation shows of an AI Coach reply's steps (#788, ADR-0077): live, while the reply is on its way, and
 * once it is there, from its stored Provenance. Pure: no DOM, so it is tested on its own.
 *
 *   let live = NO_STEP_YET;
 *   live = stepStarted(live, event);    // each `step_started` of POST /api/coach: a new object, which the thread's scrolling follows
 *   live = stepEnded(live, event);      // each `step_ended`: the step ticked
 *   liveLines(live)                     // { lines, current }: one line per Coach Action, the step under way last; the glyph's step
 *   consultedElements(provenance)       // « Le coach a consulté N éléments de Jobbbox »: each page read or proposed on, linked
 *
 * Each Coach Action (a `tool` step, Activity `act`) keeps its own line until the reply arrives; an AI step (a Guardrail's
 * « Vérification », the reply being written) only shows while it is the step under way, after them, so a check never takes
 * a Coach Action's line away.
 */
import type { Activity, Provenance, ProvenanceStep, StartedStep, StepLabel, ToolId } from "@jobhub/shared";

/** One step of the reply on its way: its Activity and label, the Tool of a Coach Action, and whether it ended. */
export type LiveStep = { id: number; activity: Activity; label: StepLabel; tool: ToolId | null; ended: boolean };

/** A reply on its way (#328): its steps in the order they started. */
export type LiveReply = { steps: readonly LiveStep[] };

export const NO_STEP_YET: LiveReply = { steps: [] };

const isCoachAction = (step: Pick<StartedStep, "kind" | "activity">) => step.kind === "tool" && step.activity === "act";

/** A step started: a new reply object, with the step last. */
export function stepStarted(live: LiveReply, event: { id: number; step: StartedStep; label: StepLabel }): LiveReply {
  const { id, step, label } = event;
  const tool = step.kind === "tool" && isCoachAction(step) ? step.tool : null;
  return { steps: [...live.steps.filter((each) => each.id !== id), { id, activity: step.activity, label, tool, ended: false }] };
}

/** A step ended: ticked, a new reply object. */
export function stepEnded(live: LiveReply, event: { id: number; step?: ProvenanceStep }): LiveReply {
  return { steps: live.steps.map((each) => (each.id === event.id ? { ...each, ended: true } : each)) };
}

/** The lines shown: each Coach Action's, then the step under way when it is an AI step; and the step under way, the glyph's. */
export function liveLines(live: LiveReply): { lines: LiveStep[]; current: LiveStep | null } {
  const current = live.steps.at(-1) ?? null;
  const lines = live.steps.filter((step) => step.tool !== null || step === current);
  return { lines, current };
}

/** The kinds of the Candidate's pages a Coach Action reads or proposes on, worded by `coachPanel.consulted.pages.<page>`. */
export type ConsultedPage = "application" | "applications" | "profile" | "job_search" | "job_searches" | "job_offer" | "job_digest" | "job_digests";

/**
 * What the AI Coach consulted in Jobbbox for a reply, from its stored Provenance, so it stays after a reload: each of the
 * Candidate's pages its Coach Actions read or proposed on (its Provenance sites), linked; with none, each Coach Action's
 * Tool, unlinked (the Agenda has no page of its own). Nothing for a reply without a Coach Action.
 */
export type ConsultedElement = { href: string; page: ConsultedPage } | { href: null; page: null; tool: ToolId };

export function consultedElements(provenance: Provenance | null): ConsultedElement[] {
  const actions = (provenance?.steps ?? []).filter(isCoachAction);
  if (actions.length === 0) return [];
  const links = provenance!.sites.flatMap((site) => (site.kind === "candidate" ? site.links : []));
  if (links.length > 0) return links.map((href) => ({ href, page: pageOf(href) }));
  return actions.map((step) => ({ href: null, page: null, tool: (step as Extract<ProvenanceStep, { kind: "tool" }>).tool }));
}

/** A page by its path: /candidatures/a1/entretiens is an Application, /recherches/s1/offres/o1 a Job Offer. */
function pageOf(href: string): ConsultedPage {
  const [first, id, inside] = href.split("/").slice(1);
  if (inside === "offres" || first === "offres") return "job_offer";
  const [one, list] = PAGES[first ?? ""] ?? PAGES.candidatures!;
  return id ? one : list;
}

/** Each of the Candidate's own pages (the link filter's), by its first segment: one object's, and its list's. */
const PAGES: Record<string, readonly [ConsultedPage, ConsultedPage]> = {
  candidatures: ["application", "applications"],
  profils: ["profile", "profile"],
  recherches: ["job_search", "job_searches"],
  "job-digests": ["job_digest", "job_digests"],
};
