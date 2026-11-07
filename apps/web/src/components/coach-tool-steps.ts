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
import type { Activity, Provenance, ProvenanceStep, SeenObject, SeenType, StartedStep, StepLabel, ToolId } from "@jobhub/shared";

/** What a Coach Action saw, as its line shows it (#788): an object by its name when the event gave one, or a list by its count. */
export type LiveSeen = { type: SeenType; name?: string; href?: string; count?: number };

/**
 * One step of the reply on its way: its Activity and label, the Tool and the name of a Coach Action, what it saw once it
 * ended, and whether it ended.
 */
export type LiveStep = { id: number; activity: Activity; label: StepLabel; tool: ToolId | null; action: string | null; seen: readonly LiveSeen[]; ended: boolean };

/** A reply on its way (#328): its steps in the order they started. */
export type LiveReply = { steps: readonly LiveStep[] };

export const NO_STEP_YET: LiveReply = { steps: [] };

const isCoachAction = (step: Pick<StartedStep, "kind" | "activity">) => step.kind === "tool" && step.activity === "act";

/** A step started: a new reply object, with the step last. */
export function stepStarted(live: LiveReply, event: { id: number; step: StartedStep; label: StepLabel }): LiveReply {
  const { id, step, label } = event;
  const tool = step.kind === "tool" && isCoachAction(step) ? step.tool : null;
  const action = step.kind === "tool" && isCoachAction(step) ? (step.action ?? null) : null;
  return { steps: [...live.steps.filter((each) => each.id !== id), { id, activity: step.activity, label, tool, action, seen: [], ended: false }] };
}

/** A step ended: ticked, with what it saw, named by the event; a new reply object. */
export function stepEnded(live: LiveReply, event: { id: number; step?: ProvenanceStep; names?: readonly (string | null)[] }): LiveReply {
  const seen = seenOf(event);
  return { steps: live.steps.map((each) => (each.id === event.id ? { ...each, ended: true, ...(seen.length > 0 ? { seen } : {}) } : each)) };
}

/** What a step's end says it saw, each object with its name from the event. */
function seenOf(event: { step?: ProvenanceStep; names?: readonly (string | null)[] }): LiveSeen[] {
  if (event.step?.kind !== "tool" || !event.step.seen) return [];
  return event.step.seen.map((object, index) => {
    const name = event.names?.[index];
    return { ...object, ...(typeof name === "string" && name ? { name } : {}) };
  });
}

/** The names a step's end gives, by the page of each object (#788): kept with the reply it served once it arrives. */
export function namesByPage(event: { step?: ProvenanceStep; names?: readonly (string | null)[] }): Record<string, string> {
  return Object.fromEntries(seenOf(event).flatMap((object) => (object.href && object.name ? [[object.href, object.name]] : [])));
}

/**
 * The lines shown: each Coach Action's, then the step under way when it is an AI step; and the step under way, the
 * glyph's: the latest started that has not ended (the reply being written is one AI step around its Coach Actions and
 * their checks), else the latest.
 */
export function liveLines(live: LiveReply): { lines: LiveStep[]; current: LiveStep | null } {
  const current = [...live.steps].reverse().find((step) => !step.ended) ?? live.steps.at(-1) ?? null;
  const lines = [...live.steps.filter((step) => step.tool !== null), ...(current && current.tool === null ? [current] : [])];
  return { lines, current };
}

/** The kinds of the Candidate's pages a Coach Action reads or proposes on, worded by `coachPanel.consulted.pages.<page>`. */
export type ConsultedPage = "application" | "applications" | "profile" | "job_search" | "job_searches" | "job_offer" | "job_digest" | "job_digests";

/**
 * What the AI Coach consulted in Jobbbox for a reply, from its stored Provenance, so it stays after a reload (#788):
 * - each object its Coach Actions saw, once, in order: by its name (`names`, by page: the object as it is now) linked to its
 *   page, else by its kind of page; a list by how many it held;
 * - for a Provenance kept before Coach Actions said what they saw: each of the Candidate's pages they read or proposed on
 *   (its Provenance sites), linked; with none, each Coach Action's Tool, unlinked (the Agenda has no page of its own).
 * Nothing for a reply without a Coach Action.
 */
export type ConsultedElement =
  | { kind: "object"; href: string | null; page: ConsultedPage | null; name: string | null; type: SeenType }
  | { kind: "count"; type: SeenType; count: number }
  | { kind: "page"; href: string; page: ConsultedPage }
  | { kind: "tool"; tool: ToolId };

export function consultedElements(provenance: Provenance | null, names: Readonly<Record<string, string>> = {}): ConsultedElement[] {
  const actions = (provenance?.steps ?? []).filter(isCoachAction) as Extract<ProvenanceStep, { kind: "tool" }>[];
  if (actions.length === 0) return [];
  const seen: SeenObject[] = actions.flatMap((step) => step.seen ?? []);
  if (seen.length > 0) return seenElements(seen, names);
  const links = provenance!.sites.flatMap((site) => (site.kind === "candidate" ? site.links : []));
  if (links.length > 0) return links.map((href) => ({ kind: "page", href, page: pageOf(href) }));
  return actions.map((step) => ({ kind: "tool", tool: step.tool }));
}

/**
 * What Coach Actions saw, each object once, in order: by its name (`names`, by page) linked to its page, else by its kind
 * of page; a list by how many it held. All of a reply's, or one Coach Action's, for its step in Activité (#807).
 */
export function seenElements(seen: readonly SeenObject[], names: Readonly<Record<string, string>> = {}): Extract<ConsultedElement, { kind: "object" | "count" }>[] {
  const once = seen.filter((object, index) => seen.findIndex((other) => JSON.stringify(other) === JSON.stringify(object)) === index);
  return once.map((object) => {
    if ("count" in object) return { kind: "count", type: object.type, count: object.count };
    const href = object.href ?? null;
    return { kind: "object", href, page: href ? pageOf(href) : null, name: href ? (names[href] ?? null) : null, type: object.type };
  });
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
