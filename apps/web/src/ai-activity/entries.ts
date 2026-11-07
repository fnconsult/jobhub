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
import type { Provenance, ProvenanceSite, ProvenanceStep, ReplyCost, StepLabel, WeeklyQuota } from "@jobhub/shared";
import { describeModel, markOf, stepLabel } from "@jobhub/shared";
import type { ActionCardStatus } from "../action-cards";
import type { ProposedChange } from "../coach-actions";
import { consultedElements, seenElements, type ConsultedElement } from "../components/coach-tool-steps";
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

/**
 * An Action Card under a reply, as the thread has it (CoachProposalCard): its id only finds what it led to and never
 * leaves the builder; `withdrawn` for one the AI Coach no longer proposes.
 */
export interface CardGiven {
  id: string;
  status: ActionCardStatus | "withdrawn";
  /** When it was applied or dismissed, an ISO date. */
  decidedAt?: string;
  change: Pick<ProposedChange, "what" | "before" | "after"> & { target: Pick<ProposedChange["target"], "href" | "name"> };
}

/**
 * An AI Coach reply of the page's Coach Conversation: its message (`messageId`, where the thread anchors it), when it was
 * saved, the Candidate's question it answers, its Provenance, what it sent in all its AI calls (#805; null before #791),
 * the names of the objects its Coach Actions saw (`seenNames`, by page, #788) and the cards it proposed.
 */
export interface ReplyGiven {
  messageId: string;
  at: Date | string;
  question: string | null;
  provenance: Provenance | null;
  sent: ReplyCost | null;
  seenNames?: Readonly<Record<string, string>>;
  cards?: readonly CardGiven[];
}

/** The kinds of entry: an AI Activity element's, a Master CV Version saved without AI, and an applied card's change. */
export type EntryKind = ElementKind | "master_cv_version" | "change";

/**
 * Where it came from: the Candidate (they launched, opened or saved it), their question (an AI Coach reply), the AI
 * Coach's proposal they applied, or Jobbbox on its own (an ATS Score computed after a save, a Job Digest sent).
 */
export type EntryOrigin = "candidate" | "question" | "coach_proposal" | "jobbbox";

/**
 * One step, as its entry shows it: its label, the Tool or model by its name for people, how many calls it folds, their
 * time; a Coach Action's, what it saw (#788), grouped as the conversation's « Le coach a consulté » groups them.
 */
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
  seen: ConsultedElement[];
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

/** How it ended, and what it gave when known: a Job Search's Job Offers, an ATS Score's score, the change a card made. */
export interface EntryResult {
  end: ElementEnd;
  offers?: number;
  score?: number;
  change?: { what: string; before: string; after: string };
}

/** A proposal of a reply, with its state, and what an applied one led to (the key of its entry). */
export interface EntryProposal {
  object: { href: string; label: string };
  what: string;
  before: string;
  after: string;
  state: "pending" | "applied" | "dismissed" | "withdrawn" | "undone";
  led: string | null;
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
  /** The message of the conversation it came from (« Voir dans la conversation »). */
  messageId?: string;
  /** The entry that caused it (« suite de »), by its key. */
  after?: string;
  /** An AI Coach reply's: the question it answered, on one line. */
  question?: string | null;
  /** An AI Coach reply's: what its Coach Actions read (« Lu : … »). */
  read?: ConsultedElement[];
  /** An AI Coach reply's: its proposals; a card not applied is no entry of its own. */
  proposals?: EntryProposal[];
}

export interface ActivityInput {
  page: PageScope;
  elements?: readonly PageElement[];
  replies?: readonly ReplyGiven[];
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
const seenOf = (step: ProvenanceStep, names: Readonly<Record<string, string>>): ConsultedElement[] => (step.kind === "tool" && step.seen ? seenElements(step.seen, names) : []);
const once = <T>(list: readonly T[]): T[] => list.filter((item, index) => list.findIndex((other) => JSON.stringify(other) === JSON.stringify(item)) === index);

/** A step as shown: steps alike (same label, Tool or model) fold into the first, their counts, times and tokens summed. */
function stepsOf(provenance: Provenance | null, names: Readonly<Record<string, string>> = {}): EntryStep[] {
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
      shown.seen = once([...shown.seen, ...seenOf(step, names)]);
      continue;
    }
    steps.push({ same, label, tool, model, count: step.count, ms: known(step.ms), tokens: tokensOf(step), seen: seenOf(step, names) });
  }
  return steps.map(({ same: _same, ...step }) => step);
}

/** Whether no AI made it: a Provenance with no AI step (Jobbbox's rules, a Coach Action's read). */
const withoutAi = (provenance: Provenance | null): boolean => provenance !== null && !provenance.steps.some((step) => step.kind === "ai");

/** An entry as built, with what linking needs besides. */
type Built = ActivityEntry & { cause?: Built; card?: string; proposal?: EntryProposal };

/** What an element of the page, or a reply, shows from its Provenance. */
function served(kind: ElementKind, provenance: Provenance | null, made: Parameters<typeof activityElement>[2], names?: Readonly<Record<string, string>>) {
  const element = activityElement(kind, provenance, made);
  const { served } = element;
  return {
    at: element.at,
    end: element.end,
    tokens: served?.tokens ?? null,
    steps: stepsOf(provenance, names),
    sites: served?.sites ?? element.sites ?? [],
    tools: served?.tools ?? [],
    models: served?.models ?? [],
  };
}

function elementEntry(given: PageElement): Built {
  const { at, end, tokens, ...shown } = served(given.kind, given.provenance, {
    ...(given.name ? { name: given.name } : {}),
    at: iso(given.at),
    ...(given.sites ? { sites: given.sites } : {}),
    ...(given.ended ? { ended: given.ended } : {}),
  });
  return {
    key: `${given.kind}:${at ?? "?"}`,
    kind: given.kind,
    at,
    object: { href: given.href ?? null, label: given.name ?? null },
    origin: BY_JOBBBOX.has(given.kind) ? "jobbbox" : "candidate",
    result: { end, ...given.result },
    ...shown,
    cost: { quota: QUOTA[given.kind] ?? null, tokens: tokens === null ? null : { count: tokens, calls: null, partial: false }, noAi: withoutAi(given.provenance) },
  };
}

const STATE: Record<CardGiven["status"], EntryProposal["state"]> = { pending: "pending", accepted: "applied", dismissed: "dismissed", withdrawn: "withdrawn", undone: "undone" };

/**
 * A reply's tokens: all its calls summed (#805), else, saved before #791, what its Provenance holds (its last call only).
 */
function replyTokens(sent: ReplyCost | null, kept: number | null): EntryCost["tokens"] {
  if (sent) return { count: sent.inputTokens + sent.outputTokens, calls: sent.calls, partial: false };
  return kept === null ? null : { count: kept, calls: null, partial: true };
}

/** A reply's entry, and the entries of the changes its applied cards made. */
function replyEntries(reply: ReplyGiven): Built[] {
  const names = reply.seenNames ?? {};
  const { at, end, tokens, ...shown } = served("coach_reply", reply.provenance, { at: iso(reply.at), sent: reply.sent }, names);
  const entry: Built = {
    key: `coach_reply:${reply.messageId}`,
    kind: "coach_reply",
    at,
    object: { href: null, label: null },
    origin: "question",
    result: { end },
    ...shown,
    cost: { quota: null, tokens: replyTokens(reply.sent, tokens), noAi: withoutAi(reply.provenance) },
    messageId: reply.messageId,
    question: reply.question === null ? null : reply.question.replace(/\s+/g, " ").trim(),
    read: consultedElements(reply.provenance, names),
    proposals: [],
  };
  const changes = (reply.cards ?? []).flatMap((card, index): Built[] => {
    const proposal: EntryProposal = { object: objectOf(card), ...changeOf(card), state: STATE[card.status], led: null };
    entry.proposals!.push(proposal);
    if (card.status !== "accepted") return [];
    return [
      {
        key: `change:${reply.messageId}:${index + 1}`,
        kind: "change",
        at: card.decidedAt ?? at,
        object: objectOf(card),
        origin: "coach_proposal",
        result: { end: { state: "done" }, change: changeOf(card) },
        steps: [],
        sites: [],
        tools: [],
        models: [],
        cost: { quota: null, tokens: null, noAi: true },
        messageId: reply.messageId,
        cause: entry,
        card: card.id,
        proposal,
      },
    ];
  });
  return [entry, ...changes];
}

const objectOf = (card: CardGiven) => ({ href: card.change.target.href, label: card.change.target.name });
const changeOf = ({ change }: CardGiven) => ({ what: change.what, before: change.before, after: change.after });

/** The page's Activité entries, the newest first. */
export function activityEntries(input: ActivityInput): ActivityEntry[] {
  const scoped = input.page === "any" ? null : SCOPED[input.page];
  const given = input.elements ?? [];
  const elements = given.map((element) => (scoped && !scoped.has(element.kind) ? null : elementEntry(element)));
  given.forEach((element, index) => {
    const cause = element.after === undefined ? null : elements[element.after];
    if (elements[index] && cause) elements[index].cause = cause;
  });
  const replies = (input.replies ?? []).flatMap(replyEntries);
  const built = [...elements.flatMap((entry) => (entry ? [entry] : [])), ...replies];
  keyed(built);
  for (const entry of built) {
    if (entry.cause) entry.after = entry.cause.key;
    if (entry.proposal) entry.proposal.led = entry.key;
  }
  return newestFirst(built).map(({ cause: _cause, card: _card, proposal: _proposal, ...entry }) => entry);
}

/** Keeps each entry's key unique: one alike an earlier one is numbered. */
function keyed(entries: Built[]): void {
  const taken = new Map<string, number>();
  for (const entry of entries) {
    const n = taken.get(entry.key) ?? 0;
    taken.set(entry.key, n + 1);
    if (n > 0) entry.key = `${entry.key}#${n + 1}`;
  }
}

/** The newest first; one not dated last. */
function newestFirst(entries: Built[]): Built[] {
  return [...entries].sort((one, other) => (other.at ?? "").localeCompare(one.at ?? ""));
}
