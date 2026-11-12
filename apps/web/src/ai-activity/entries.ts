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
 *
 * A Profile's creation (ADR-0070, #810) is one entry, « Création du profil », grouping its `parts` in their order: the
 * uploaded CV read (its Provenance, the only AI), the Onboarding Questionnaire, the review, « Profil créé » with Master CV
 * Version 1, and Version 1's ATS Score. On a Profile's page it is made from what is kept (Version 1, its Provenance, its
 * ATS Score); the browser adds what it alone knows while it is being created (`creation`): the questionnaire and the
 * review, never kept, so gone once the page is loaded again.
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

/**
 * A Master CV Version of the Profile (MasterCvVersion): saved by hand, from a Coach proposal the Candidate applied (its
 * Origin names the card, which never leaves the builder), or read from their file (its Provenance). `href`: the Master CV's page.
 */
export interface VersionGiven {
  version: number;
  savedAt: Date | string;
  restoredFrom: number | null;
  provenance?: Provenance | null;
  origin?: { cardId: string } | null;
  href?: string;
}

/** The parts of a Profile's creation (#810), in their order: an ATS Score is Version 1's. */
export const CREATION_PARTS = ["cv_reading", "questionnaire", "review", "profile_created", "ats_score"] as const;
export type CreationPartKind = (typeof CREATION_PARTS)[number];

/**
 * The kinds of entry: an AI Activity element's, a Master CV Version saved without AI, an applied card's change, and a
 * Profile's creation with the kinds of its parts.
 */
export type EntryKind = ElementKind | "master_cv_version" | "change" | "profile_creation" | CreationPartKind;

/**
 * A Profile's creation as the page knows it (#810): its page once created (`href`), and what only the browser knows while
 * the Candidate creates it on `/profils/nouveau`, kept in memory until the page is loaded again: the uploaded CV read (its
 * draft's Provenance), the Onboarding Questionnaire (when it started, the answers given and skipped) and the review.
 */
export interface CreationGiven {
  href?: string;
  reading?: { provenance: Provenance | null };
  questionnaire?: { at: string; answered: number; skipped: number };
  /** The Profile born during the questionnaire, once its target role and location were answered (ADR-0106, #999): its Version 1. */
  created?: { at: string; href: string };
  review?: { at: string };
}

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
  /** A Master CV Version's number, and the earlier one it restored (« Annuler »). */
  version?: number;
  restoredFrom?: number | null;
  /** The Onboarding Questionnaire's answers given, and those skipped. */
  answered?: number;
  skipped?: number;
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
  /** An AI Activity element whose Provenance was not kept: « modèle non enregistré », in no total. */
  unrecorded?: true;
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
  /** A Profile's creation's: its parts, in their order, each as an entry. */
  parts?: ActivityEntry[];
}

export interface ActivityInput {
  page: PageScope;
  elements?: readonly PageElement[];
  replies?: readonly ReplyGiven[];
  /** Counted on a Profile's page only. */
  versions?: readonly VersionGiven[];
  /**
   * Entries the server built already from what it alone reads (`servedEntries`, #808): the browser adds the replies its
   * thread shows, with their cards. A served reply the thread shows gives way to the thread's.
   */
  built?: readonly ServedEntry[];
  /** A Profile's creation as the page knows it: on a Profile's page, its page; in the browser, what it alone knows. */
  creation?: CreationGiven;
}

/**
 * An entry as the server serves it to the browser (#808): with, on a Master CV Version made from a Coach proposal, the
 * card its Origin names (`card`), which the thread's cards already hold, so the browser can link it to the reply.
 */
export type ServedEntry = ActivityEntry & { card?: string };

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
  const steps = new Map<string, EntryStep>();
  for (const step of provenance?.steps ?? []) {
    const label = stepLabel(step);
    const tool = step.kind === "tool" ? (markOf(step).text ?? null) : null;
    const model = step.kind === "ai" && step.model ? describeModel(step.model, step.provider).name : null;
    const same = JSON.stringify([label, step.kind, tool, model]);
    const shown = steps.get(same);
    if (shown) {
      shown.count += step.count;
      shown.ms = add(shown.ms, known(step.ms));
      shown.tokens = add(shown.tokens, tokensOf(step));
      shown.seen = once([...shown.seen, ...seenOf(step, names)]);
      continue;
    }
    steps.set(same, { label, tool, model, count: step.count, ms: known(step.ms), tokens: tokensOf(step), seen: seenOf(step, names) });
  }
  return [...steps.values()];
}

/** Whether no AI made it: a Provenance with no AI step (Jobbbox's rules, a Coach Action's read). */
const withoutAi = (provenance: Provenance | null): boolean => provenance !== null && !provenance.steps.some((step) => step.kind === "ai");

/**
 * An entry as built, with what linking needs besides: its cause; a version's or a change's card and the proposal it
 * fulfils; a reply's proposals by their card.
 */
type Built = ActivityEntry & { cause?: Built; card?: string; proposal?: EntryProposal; cards?: Map<string, EntryProposal> };

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
    ...(provenance ? {} : { unrecorded: true as const }),
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
    cards: new Map(),
  };
  const changes = (reply.cards ?? []).flatMap((card, index): Built[] => {
    const proposal: EntryProposal = { object: objectOf(card), ...changeOf(card), state: STATE[card.status], led: null };
    entry.proposals!.push(proposal);
    entry.cards!.set(card.id, proposal);
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

/**
 * A Master CV Version's entry: an AI Activity element when read from the Candidate's file, else the version saved without
 * AI, by hand or from the card its Origin names.
 */
function versionEntry(given: VersionGiven): Built {
  const href = given.href ?? null;
  if (given.provenance) {
    const read = elementEntry({ kind: "master_cv", provenance: given.provenance, at: given.savedAt, ...(href ? { href } : {}) });
    return { ...read, key: `master_cv:${given.version}`, result: { ...read.result, version: given.version } };
  }
  return {
    key: `master_cv_version:${given.version}`,
    kind: "master_cv_version",
    at: iso(given.savedAt),
    object: { href, label: null },
    origin: given.origin ? "coach_proposal" : "candidate",
    result: { end: { state: "done" }, version: given.version, restoredFrom: given.restoredFrom },
    steps: [],
    sites: [],
    tools: [],
    models: [],
    cost: { quota: null, tokens: null, noAi: true },
    ...(given.origin ? { card: given.origin.cardId } : {}),
  };
}

const objectOf = (card: CardGiven) => ({ href: card.change.target.href, label: card.change.target.name });
const changeOf = ({ change }: CardGiven) => ({ what: change.what, before: change.before, after: change.after });

/** The page's Activité entries, the newest first. */
export function activityEntries(input: ActivityInput): ActivityEntry[] {
  return build(input).map(shown);
}

/**
 * The entries the server builds from the page's elements, versions and the replies it reads (#808), for the browser to
 * finish with its thread's (`built`): what crosses to the browser, never a Provenance.
 */
export function servedEntries(input: Omit<ActivityInput, "built">): ServedEntry[] {
  return build(input).map((entry) => ({ ...shown(entry), ...(entry.card ? { card: entry.card } : {}) }));
}

function build(input: ActivityInput): Built[] {
  const scoped = input.page === "any" ? null : SCOPED[input.page];
  const given = input.elements ?? [];
  // On a Profile's page, Version 1 and its ATS Score are its creation's (#810).
  const first = input.page === "profile" ? input.versions?.find((version) => version.version === FIRST) : undefined;
  const firstScore = first ? given.findIndex((element) => element.kind === "ats_score" && element.scored === FIRST) : -1;
  const elements = given.map((element, index) => (index === firstScore || (scoped && !scoped.has(element.kind)) ? null : elementEntry(element)));
  const replies = (input.replies ?? []).flatMap(replyEntries);
  const versions = input.page === "profile" ? (input.versions ?? []).filter((version) => version !== first).map((version) => [version.version, versionEntry(version)] as const) : [];
  const version = new Map(versions);
  given.forEach((element, index) => {
    const cause = element.after !== undefined ? elements[element.after] : element.scored !== undefined ? version.get(element.scored) : undefined;
    if (elements[index] && cause && cause !== elements[index]) elements[index].cause = cause;
  });
  const prior = builtBefore(input.built ?? [], new Set(replies.flatMap((entry) => (entry.kind === "coach_reply" ? [entry.messageId!] : []))));
  // A version a card created is the change it made (even once undone): it follows that card's reply, in its place.
  const madeVersion = new Set<string>();
  for (const entry of [...versions.map(([, each]) => each), ...prior]) {
    const reply = entry.card ? replies.find((each) => each.cards?.has(entry.card!)) : undefined;
    if (!reply) continue;
    Object.assign(entry, { cause: reply, messageId: reply.messageId, proposal: reply.cards!.get(entry.card!) });
    madeVersion.add(entry.card!);
  }
  const creation = creationAmong(prior, first ? keptParts(first, given[firstScore]) : null, input.creation);
  const built = newestFirst([
    ...prior,
    ...(creation ? [creation] : []),
    ...elements.flatMap((entry) => (entry ? [entry] : [])),
    ...replies.filter((entry) => !(entry.kind === "change" && madeVersion.has(entry.card!))),
    ...versions.map(([, entry]) => entry),
  ]);
  keyed(built);
  for (const entry of built) {
    if (entry.cause) entry.after = entry.cause.key;
    if (entry.proposal) entry.proposal.led = entry.key;
  }
  return built;
}

const FIRST = 1;
const CREATION = "profile_creation";

/** An entry without AI of the Profile's creation, or one of the page's elements as a part of it: dated, done, linked to nothing. */
function part(kind: CreationPartKind, at: string | null, origin: EntryOrigin, result: Partial<EntryResult> = {}, href: string | null = null): ActivityEntry {
  return {
    key: `${CREATION}:${kind}`,
    kind,
    at,
    object: { href, label: null },
    origin,
    result: { end: { state: "done" }, ...result },
    steps: [],
    sites: [],
    tools: [],
    models: [],
    cost: { quota: null, tokens: null, noAi: true },
  };
}

/** An element of the page as a part of the creation: its kind and key the part's, linked to nothing. */
const asPart = (kind: CreationPartKind, entry: Built): ActivityEntry => ({ ...shown(entry), key: `${CREATION}:${kind}`, kind });

/** The CV read, from its Provenance: the creation's only AI. */
const readingPart = (provenance: Provenance, at?: Date | string) => asPart("cv_reading", elementEntry({ kind: "master_cv", provenance, ...(at ? { at } : {}) }));

/** What is kept of a Profile's creation: the CV read (Version 1's Provenance), Version 1, and Version 1's ATS Score. */
function keptParts(first: VersionGiven, score: PageElement | undefined): ActivityEntry[] {
  return [
    ...(first.provenance ? [readingPart(first.provenance, first.savedAt)] : []),
    part("profile_created", iso(first.savedAt), "candidate", { version: first.version }, first.href ?? null),
    ...(score ? [asPart("ats_score", elementEntry(score))] : []),
  ];
}

/**
 * What the browser alone knows of a Profile's creation: the CV read from its draft, the questionnaire, the Profile born
 * during it (#999: « Profil créé » with its Version 1, before the review) and the review.
 */
function knownParts(creation: CreationGiven): ActivityEntry[] {
  const { reading, questionnaire, created, review } = creation;
  const read = reading ? (reading.provenance ? readingPart(reading.provenance) : asPart("cv_reading", elementEntry({ kind: "master_cv", provenance: null }))) : null;
  return [
    ...(read ? [read] : []),
    ...(questionnaire ? [part("questionnaire", questionnaire.at, "jobbbox", { answered: questionnaire.answered, skipped: questionnaire.skipped })] : []),
    ...(created ? [part("profile_created", created.at, "candidate", { version: FIRST }, created.href)] : []),
    ...(review ? [part("review", review.at, "candidate")] : []),
  ];
}

/**
 * « Création du profil »: its parts in their order, one of each kind (the first given); dated by the first; created with
 * the version of « Profil créé »; its models, Tools and sites, and its cost, the CV read's tokens, else without AI.
 */
function creationEntry(given: readonly ActivityEntry[], href: string | null): Built {
  const parts = CREATION_PARTS.flatMap((kind) => given.filter((each) => each.kind === kind).slice(0, 1));
  const reading = parts.find((each) => each.kind === "cv_reading");
  const created = parts.find((each) => each.kind === "profile_created");
  const at = parts.flatMap((each) => (each.at ? [each.at] : [])).sort()[0] ?? null;
  return {
    key: CREATION,
    kind: CREATION,
    at,
    object: { href, label: null },
    origin: "candidate",
    result: { end: { state: "done" }, ...(created ? { version: created.result.version } : {}) },
    steps: [],
    sites: once(parts.flatMap((each) => each.sites)),
    tools: once(parts.flatMap((each) => each.tools)),
    models: once(parts.flatMap((each) => each.models)),
    cost: { quota: null, tokens: reading?.cost.tokens ?? null, noAi: !reading || reading.cost.noAi },
    parts,
  };
}

/**
 * The page's « Création du profil », if any: the server's (`prior`), with what the browser knows when it is this Profile's;
 * else the one made from what is kept (`kept`, a Profile's page); else, on `/profils/nouveau` (no page yet), what the
 * browser knows. One served is finished in place, and none is returned.
 */
function creationAmong(prior: Built[], kept: ActivityEntry[] | null, creation: CreationGiven | undefined): Built | null {
  const known = creation ? knownParts(creation) : [];
  const served = prior.find((entry) => entry.kind === CREATION);
  if (served) {
    if (creation?.href && served.object.href === creation.href) Object.assign(served, creationEntry([...(served.parts ?? []), ...known], served.object.href));
    return null;
  }
  if (kept) return creationEntry([...kept, ...known], creation?.href ?? null);
  return !creation?.href && known.length > 0 ? creationEntry(known, null) : null;
}

/** The server's entries, linked again by their keys; a reply the thread shows (`shown`) gives way to the thread's. */
function builtBefore(served: readonly ServedEntry[], shown: ReadonlySet<string>): Built[] {
  const prior: Built[] = served.filter((entry) => !(entry.kind === "coach_reply" && shown.has(entry.messageId!))).map((entry) => structuredClone(entry));
  const byKey = new Map(prior.map((entry) => [entry.key, entry]));
  for (const entry of prior) {
    const cause = entry.after ? byKey.get(entry.after) : undefined;
    if (cause) entry.cause = cause;
  }
  return prior;
}

/** Keeps each entry's key unique: one alike an earlier one in the page's order is numbered. */
function keyed(entries: Built[]): void {
  const taken = new Map<string, number>();
  for (const entry of entries) {
    const n = taken.get(entry.key) ?? 0;
    taken.set(entry.key, n + 1);
    if (n > 0) entry.key = `${entry.key}#${n + 1}`;
  }
}

/** An entry as it leaves the builder: what linked it stays inside. */
function shown(built: Built): ActivityEntry {
  const entry: Partial<Built> = { ...built };
  delete entry.cause;
  delete entry.card;
  delete entry.proposal;
  delete entry.cards;
  return entry as ActivityEntry;
}

/**
 * The newest first, one not dated last; at the same time, a consequence before what caused it, then by what it is (its
 * key, then its object), so the order never depends on the order the entries were given in.
 */
function newestFirst(entries: Built[]): Built[] {
  const depth = (entry: Built, seen = new Set<Built>()): number => (entry.cause && !seen.has(entry) ? 1 + depth(entry.cause, seen.add(entry)) : 0);
  const compare = (one: string, other: string) => (one < other ? -1 : one > other ? 1 : 0);
  return [...entries].sort(
    (one, other) =>
      compare(other.at ?? "", one.at ?? "") ||
      depth(other) - depth(one) ||
      compare(one.key, other.key) ||
      compare(one.object.href ?? "", other.object.href ?? "") ||
      compare(one.object.label ?? "", other.object.label ?? ""),
  );
}
