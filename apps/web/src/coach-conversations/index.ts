/**
 * Coach Conversations: the Candidate's conversations with the AI Coach, saved so they survive a reload and can be
 * reopened later. Each has a Subject (ADR-0070, #600): one of the Candidate's objects (an Application, a Profile, a Job
 * Search, a Job Digest) or Sidebar menus (Mes candidatures, Recherches d'offres, Job Digests, Agenda, Mes coachs humains),
 * which has at most one conversation, created at its first message, never empty; or none, for a Free conversation.
 *
 * One deep module in front of Postgres. Callers get
 * `createCoachConversations(database, { coach, profiles })`:
 *  - `send` the Candidate's next message, untrusted input from the browser
 *    `{ conversationId? | subject?, message, focus?, helpArticle? }`: the AI Coach answers the saved
 *    conversation (`subject`'s, started by this message if it has none, attached to the Subject's Profile; a new Free
 *    conversation with neither, attached to the Profile in view when it starts, or to the Profile the page in view
 *    shows: `focus.profileId`) and both messages are saved together. A Subject that is not the Candidate's is "not
 *    found". Nothing is saved when the AI Coach cannot answer, so the Candidate can send again. `helpArticle`, the Help Article the
 *    Candidate read just before asking (#342), goes to the AI Coach by its id and is never saved (ADR-0035);
 *  - `ofSubject` the conversation of a Subject with its messages, or null before its first message;
 *  - `list` the Candidate's conversations, most recently active first;
 *  - `open` one with its messages; `rename` it; `delete` it;
 *  - `repliesAbout` a page's object: the replies whose focus it is, from any conversation, for AI Activity.
 * Every new conversation opens with the AI disclosure (#324, AI Act art. 50(1)): the AI Coach's fixed
 * first message saying it is an AI, not a person. It is fixed text, not an AI reply (no AI call, no
 * Plan Quota, no Coach Message Cost), so only the conversation records that it opened with it.
 * Every read and change is scoped to the Candidate: another Candidate's
 * conversation is "not found". Never throws for bad input: an error code comes back.
 * Each AI Coach message is saved with what it cost (provider, model, tokens in,
 * out and cached, estimated €) and the Coaching Playbooks and Core Digest it drew
 * on, with their versions (#129), and each Playbook Agent consultation with its cost
 * (#225); `coachCostPerDay` gives the Administrator the median and p90 cost per day,
 * to check the €0.03 per message target (#127), and which playbook versions answered;
 * `coachCostPerPlaybookAgent` the median cost of each Playbook Agent's consultations.
 * Guardrails (#228): a Candidate message a Guardrail blocked and the Guardrail message that answered it are
 * both saved, marked as blocked without naming the Guardrail, and are no longer given to the AI Coach; a
 * reply replaced by its Guardrail message is marked as blocked too; a distress answer never is. `language`
 * is the Candidate's, for the Guardrail message.
 * Each AI Coach reply is saved with its Provenance (ADR-0034, #327), given back with it and when the conversation reopens, and
 * with its Focus: the Subject's object, or what was In view when it was asked (any of the six kinds, #600), for AI Activity.
 * A reply saved before Provenance was kept gets a partial one, read on the fly from its provider, model and tokens.
 * A reply to a Job Offer link is saved with its Job Offer card, which reopens with the conversation, `followed`
 * once the Candidate has saved that Job Offer as an Application; the AI Coach is only ever given the reply's text.
 * Each reply is told to Unanswered Questions (#344, ADR-0035) with its question, the page it was asked from (`route`, the
 * address of the page in view) and the Candidate's language: they keep, unlinked to the Candidate, the questions the help
 * missed. A reply is never held back by it.
 * An archived object keeps its conversation (it is found again once restored); a deleted object takes it along.
 * Kept RETENTION_MONTHS after their last message (`purgeStaleCoachConversations`,
 * run daily by the worker) and deleted with the account (ADR-0010). Human
 * Coaches never read them: Coach Access covers Profiles and Applications only.
 */
import { activityOf } from "@jobhub/ai";
import { readProvenance, type FailureReason, type JobOffer, type Provenance, type ProvenanceEvent } from "@jobhub/shared";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import * as z from "zod";
import { COACH_FOCUS_KINDS, type Coach, type CoachMessageCost, type CoachReply, type PlaybookConsultation, type PlaybookUsed } from "../coach";
import { MAX_MESSAGE_LENGTH, MAX_MESSAGES, type CoachMessage, type JobOfferCard } from "../coach/conversation";
import type { GuardrailLanguage } from "../guardrails";
import type { Profiles } from "../profiles";
import type { UnansweredQuestions } from "../unanswered-questions";

/**
 * The Sidebar menus that are each one Coach Conversation per Candidate (ADR-0070), by their Sidebar key:
 * Mes candidatures, Recherches d'offres, Job Digests, Agenda, Mes coachs humains.
 */
export const SUBJECT_MENUS = ["applications", "jobSearches", "jobDigests", "agenda", "humanCoaches"] as const;
export type SubjectMenu = (typeof SUBJECT_MENUS)[number];

/** The objects a Coach Conversation can be about (ADR-0070). */
export const SUBJECT_OBJECT_KINDS = ["application", "profile", "job_search", "job_digest"] as const;
export type SubjectObjectKind = (typeof SUBJECT_OBJECT_KINDS)[number];

/** A Subject as the browser names it: one of the Candidate's objects by its id, or a Sidebar menu by its key. */
export type SubjectRef = { kind: SubjectObjectKind; id: string } | { kind: "menu"; id: SubjectMenu };

/** What a Coach Conversation is about, fixed when it starts, with the name it is shown under. A Free conversation has none. */
export type Subject = SubjectRef & { name: string };

export interface CoachConversationSummary {
  id: string;
  title: string;
  /** What it is about; null for a Free conversation. */
  subject: Subject | null;
  /** The Profile it is attached to: a Free conversation's Profile in view when it started, the Subject's own Profile otherwise; none for a menu. */
  profile: { id: string; name: string } | null;
  lastMessageAt: Date;
}

export interface CoachConversation extends CoachConversationSummary {
  /**
   * Whether it opened with the AI disclosure: the AI Coach's fixed first message saying it is an AI, not a person
   * (AI Act art. 50(1), #324), shown before its messages. Every new conversation does; one saved before it existed
   * does not. The disclosure is fixed text, never an AI reply, so it is not among the messages nor given to the AI Coach.
   */
  aiDisclosure: boolean;
  messages: CoachMessage[];
}

/**
 * `blocked`: whether the Candidate's message and the reply were marked as blocked (#228). `jobOffer`: the reply's Job Offer card, if any.
 * `provenance`: what served the reply (#327); `at`: when it was saved, an ISO date.
 * `couldNotAnswer`: the AI Coach marked the question as one it could not answer (#345), so the Coach Panel offers the team at
 * once; never saved, so a reopened conversation no longer says it.
 * `stopped` (#328): the Candidate stopped the reply; their message is saved in `conversation`, with no reply.
 * `unavailable`: the AI Coach could not answer, `reason` its Failure Reason; nothing is saved.
 */
export type SendResult =
  | {
      ok: true;
      conversation: CoachConversationSummary;
      reply: string;
      blocked: { message: boolean; reply: boolean };
      jobOffer?: JobOfferCard;
      provenance: Provenance;
      at: string;
      couldNotAnswer: boolean;
    }
  | { ok: false; error: "stopped"; conversation: CoachConversationSummary }
  | { ok: false; error: "unavailable"; reason: FailureReason }
  | { ok: false; error: "invalid" | "not_found" };

/**
 * What `send` tells as it goes (#328): first the conversation the message goes to (a new one is named already, though
 * saved only with the message), then each step of the reply as it starts and ends.
 */
export type CoachEvent = { type: "conversation"; conversation: CoachConversationSummary } | ProvenanceEvent;

export interface SendOptions {
  /** The Candidate's, for a Guardrail message. */
  language?: GuardrailLanguage;
  /** The Candidate's Stop (#328): the reply's AI calls are aborted, and only the Candidate's message is saved. */
  signal?: AbortSignal;
  onEvent?: (event: CoachEvent) => void;
}

/** The conversation of a Subject, null until its first message; `not_found` when the Subject is not the Candidate's. */
export type OfSubjectResult = { ok: true; conversation: CoachConversation | null } | { ok: false; error: "invalid" | "not_found" };

export type RenameResult = { ok: true; conversation: CoachConversationSummary } | { ok: false; error: "invalid" | "not_found" };

export interface CoachConversations {
  send(candidateId: string, input: unknown, options?: SendOptions): Promise<SendResult>;
  /** The Candidate's conversations, most recently active first. */
  list(candidateId: string): Promise<CoachConversationSummary[]>;
  open(candidateId: string, conversationId: string): Promise<CoachConversation | null>;
  /** The conversation of `subject` (untrusted: `{ kind, id }`), with its messages, or null before its first message. */
  ofSubject(candidateId: string, subject: unknown): Promise<OfSubjectResult>;
  /** `title` is untrusted: trimmed, 1 to MAX_TITLE_LENGTH characters. */
  rename(candidateId: string, conversationId: string, title: unknown): Promise<RenameResult>;
  /** Deletes the conversation and its messages; false when there is none of the Candidate's to delete. */
  delete(candidateId: string, conversationId: string): Promise<boolean>;
  /**
   * The Candidate's AI Coach replies whose Focus is `focus` (one of the six kinds In view; the Agenda whatever its id), from any of their
   * conversations, oldest first: when each was saved and its Provenance (a partial one for a reply saved before, null when
   * none was kept), never its text. What AI Activity counts with that object's page.
   */
  repliesAbout(candidateId: string, focus: Focus): Promise<ReplyAbout[]>;
}

/** An AI Coach reply as AI Activity counts it with its focus's page: when it was saved, an ISO date, and what served it. */
export interface ReplyAbout {
  at: string;
  provenance: Provenance | null;
}

export interface CoachConversationsDeps {
  coach: Pick<Coach, "reply">;
  profiles: Pick<Profiles, "get">;
  /** Where each reply is told, for the questions the help missed (#344). Without it, nothing is. */
  unansweredQuestions?: Pick<UnansweredQuestions, "notice">;
  /** When messages are sent. Default: the system clock. */
  now?: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest conversation title; a new conversation is named after the start of its first message. */
export const MAX_TITLE_LENGTH = 80;

const titleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH);

const subjectSchema = z.union([
  z.object({ kind: z.enum(SUBJECT_OBJECT_KINDS), id: z.string().regex(UUID) }),
  z.object({ kind: z.literal("menu"), id: z.enum(SUBJECT_MENUS) }),
]);

const sendSchema = z.object({
  conversationId: z.string().regex(UUID).optional(),
  /** Without `conversationId`: the conversation of this Subject, started by this message if it has none yet. */
  subject: subjectSchema.optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  /** What is in view; `profileId`: the Profile a Job Search, Job Digest or Application page shows, to attach a new conversation to. */
  focus: z.object({ kind: z.enum(COACH_FOCUS_KINDS), id: z.string().max(100), profileId: z.string().max(100).optional() }).optional(),
  /** The Help Article read just before asking (#342): given to the AI Coach by its id, never saved (ADR-0035). */
  helpArticle: z.object({ id: z.string().max(100), title: z.string().max(200).optional() }).optional(),
  /** The address of the page in view (#344): only its route pattern is kept, with an Unanswered Question. */
  route: z.string().max(300).optional(),
});

type FocusInput = z.infer<typeof sendSchema>["focus"];

/** What a reply's Focus can be (#327, #600): the six kinds In view, what AI Activity counts the reply with. */
export const FOCUS_KINDS = ["application", "job_offer", "profile", "job_search", "job_digest", "agenda"] as const;
export type FocusKind = (typeof FOCUS_KINDS)[number];
export type Focus = { kind: FocusKind; id: string };

/** The Agenda as a Focus: it has no id of its own, so it is kept without one. */
const AGENDA_FOCUS: Focus = { kind: "agenda", id: "agenda" };

/** What is In view as a Focus: the Agenda, or an object by its id. */
function focusOf(focus: FocusInput | Focus): Focus | null {
  if (!focus || !(FOCUS_KINDS as readonly string[]).includes(focus.kind)) return null;
  if (focus.kind === "agenda") return AGENDA_FOCUS;
  return UUID.test(focus.id) ? { kind: focus.kind as FocusKind, id: focus.id } : null;
}

/** A reply's Focus (CONTEXT.md): the Subject's object, the Agenda for its menu, else what is In view when it was asked. */
function focusFor(subject: Subject | null, inView: FocusInput): Focus | null {
  if (subject && subject.kind !== "menu") return { kind: subject.kind, id: subject.id };
  if (subject?.kind === "menu" && subject.id === "agenda") return AGENDA_FOCUS;
  return focusOf(inView);
}

/** What a saved AI Coach reply kept of what served it, as `SAVED_REPLY_COLUMNS` reads it from `coach_message` (aliased `m`). */
export interface SavedReply {
  provenance: unknown;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  at: Date;
}

export const SAVED_REPLY_COLUMNS = `m.provenance, m.provider, m.model, m.input_tokens AS "inputTokens", m.output_tokens AS "outputTokens",
       m.cached_input_tokens AS "cachedInputTokens", m.created_at AS at`;

/**
 * A saved AI Coach reply's Provenance (#327): the one stored, else a partial one read on the fly from its provider, model and
 * tokens (a reply saved before Provenance was kept), else none (« modèle non enregistré »).
 */
export function savedReplyProvenance(reply: SavedReply): Provenance | null {
  return readProvenance(reply.provenance, { activity: activityOf({ kind: "ai", task: "coaching" }), task: "coaching", ...reply });
}

/** A saved message as read back, with what an AI Coach reply kept of what served it. */
interface MessageRow extends SavedReply {
  from: CoachMessage["from"];
  text: string;
  blocked: boolean;
  jobOffer: JobOfferCard | null;
}

/** What a Subject's name is made of, as `SUBJECT_COLUMNS` reads it. */
export interface SubjectRow {
  subject_kind: SubjectObjectKind | "menu" | null;
  subject_menu: SubjectMenu | null;
  application_id: string | null;
  job_search_id: string | null;
  job_digest_id: string | null;
  profile_id: string | null;
  profile_name: string | null;
  subject_offer_title: string | null;
  subject_offer_employer: string | null;
  subject_search_started_at: Date | null;
  subject_digest_sent_at: Date | null;
}

/** Where each Subject's id is kept on `coach_conversation`: a column per kind of object, the menu's key for a menu. */
const SUBJECT_COLUMN = { application: "application_id", profile: "profile_id", job_search: "job_search_id", job_digest: "job_digest_id", menu: "subject_menu" } as const;

/** The columns `subjectFrom` reads, from `coach_conversation c` and `SUBJECT_JOINS`. */
export const SUBJECT_COLUMNS = `c.subject_kind, c.subject_menu, c.application_id, c.job_search_id, c.job_digest_id, c.profile_id, sp.name AS profile_name,
       so.title AS subject_offer_title, so.employer AS subject_offer_employer, ss.started_at AS subject_search_started_at, sd.sent_at AS subject_digest_sent_at`;
export const SUBJECT_JOINS = `LEFT JOIN profile sp ON sp.id = c.profile_id
       LEFT JOIN application sa ON sa.id = c.application_id LEFT JOIN job_offer so ON so.id = sa.job_offer_id
       LEFT JOIN job_search ss ON ss.id = c.job_search_id LEFT JOIN job_digest sd ON sd.id = c.job_digest_id`;

/** The French names of the Sidebar menus, as the Sidebar shows them. */
const MENU_NAMES: Record<SubjectMenu, string> = {
  applications: "Mes candidatures",
  jobSearches: "Recherches d'offres",
  jobDigests: "Job Digests",
  agenda: "Agenda",
  humanCoaches: "Mes coachs humains",
};

const SUBJECT_DAY = new Intl.DateTimeFormat("fr", { timeZone: "Europe/Paris", dateStyle: "long" });

/** A conversation's Subject, named: an Application by its Job Offer, a Profile by its name, a Job Search or Job Digest by its date and Profile. */
export function subjectFrom(row: SubjectRow): Subject | null {
  const profile = row.profile_name ?? "";
  switch (row.subject_kind) {
    case "application":
      return { kind: "application", id: row.application_id!, name: [row.subject_offer_title, row.subject_offer_employer].filter(Boolean).join(" · ") };
    case "profile":
      return { kind: "profile", id: row.profile_id!, name: profile };
    case "job_search":
      return { kind: "job_search", id: row.job_search_id!, name: `Recherche d'offres du ${SUBJECT_DAY.format(row.subject_search_started_at!)} · ${profile}` };
    case "job_digest":
      return { kind: "job_digest", id: row.job_digest_id!, name: `Job Digest du ${SUBJECT_DAY.format(row.subject_digest_sent_at!)} · ${profile}` };
    case "menu":
      return { kind: "menu", id: row.subject_menu!, name: MENU_NAMES[row.subject_menu!] };
    default:
      return null;
  }
}

/** The Profile a conversation is attached to: a Free conversation's, or its Subject's own Profile; none for a menu. */
export function attachedProfileFrom(row: SubjectRow): { id: string; name: string } | null {
  return row.profile_id && row.profile_name !== null && row.subject_kind !== "menu" ? { id: row.profile_id, name: row.profile_name } : null;
}

interface ConversationRow extends SubjectRow {
  id: string;
  title: string;
  last_message_at: Date;
  ai_disclosure: boolean;
}

const SUMMARY = `SELECT c.id, c.title, c.last_message_at, c.ai_disclosure, ${SUBJECT_COLUMNS}
                   FROM coach_conversation c ${SUBJECT_JOINS}`;

function summaryFrom(row: ConversationRow): CoachConversationSummary {
  return {
    id: row.id,
    title: row.title,
    subject: subjectFrom(row),
    profile: attachedProfileFrom(row),
    lastMessageAt: row.last_message_at,
  };
}

const NO_SUBJECT: SubjectRow = {
  subject_kind: null,
  subject_menu: null,
  application_id: null,
  job_search_id: null,
  job_digest_id: null,
  profile_id: null,
  profile_name: null,
  subject_offer_title: null,
  subject_offer_employer: null,
  subject_search_started_at: null,
  subject_digest_sent_at: null,
};

/** The Candidate's own object a Subject names, with the Profile it belongs to, as `subjectFrom` reads it; null when it is not theirs. */
const OWN_SUBJECT: Record<SubjectObjectKind, string> = {
  application: `SELECT 'application' AS subject_kind, a.id AS application_id, a.profile_id, p.name AS profile_name, o.title AS subject_offer_title, o.employer AS subject_offer_employer
                  FROM application a JOIN profile p ON p.id = a.profile_id JOIN job_offer o ON o.id = a.job_offer_id WHERE a.id = $1 AND a.candidate_id = $2`,
  profile: `SELECT 'profile' AS subject_kind, p.id AS profile_id, p.name AS profile_name FROM profile p WHERE p.id = $1 AND p.candidate_id = $2`,
  job_search: `SELECT 'job_search' AS subject_kind, s.id AS job_search_id, s.profile_id, p.name AS profile_name, s.started_at AS subject_search_started_at
                 FROM job_search s JOIN profile p ON p.id = s.profile_id WHERE s.id = $1 AND s.candidate_id = $2`,
  job_digest: `SELECT 'job_digest' AS subject_kind, d.id AS job_digest_id, d.profile_id, p.name AS profile_name, d.sent_at AS subject_digest_sent_at
                 FROM job_digest d JOIN profile p ON p.id = d.profile_id WHERE d.id = $1 AND d.candidate_id = $2`,
};

function titleFrom(message: string): string {
  const words = message.replace(/\s+/g, " ").trim();
  return words.length <= MAX_TITLE_LENGTH ? words : `${words.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function createCoachConversations(database: Pool, deps: CoachConversationsDeps): CoachConversations {
  const now = deps.now ?? (() => new Date());
  async function findRow(candidateId: string, conversationId: string): Promise<ConversationRow | null> {
    if (!UUID.test(conversationId)) return null;
    const { rows } = await database.query<ConversationRow>(`${SUMMARY} WHERE c.id = $1 AND c.candidate_id = $2`, [conversationId, candidateId]);
    return rows[0] ?? null;
  }
  async function find(candidateId: string, conversationId: string): Promise<CoachConversationSummary | null> {
    const row = await findRow(candidateId, conversationId);
    return row ? summaryFrom(row) : null;
  }
  async function findOfSubject(candidateId: string, subject: SubjectRef): Promise<ConversationRow | null> {
    const { rows } = await database.query<ConversationRow>(`${SUMMARY} WHERE c.candidate_id = $1 AND c.subject_kind = $2 AND c.${SUBJECT_COLUMN[subject.kind]} = $3`, [
      candidateId,
      subject.kind,
      subject.id,
    ]);
    return rows[0] ?? null;
  }

  /**
   * The Subject named, if it is the Candidate's (an archived object still is), with what a new conversation about it is
   * attached to: its own Profile; none for a menu.
   */
  async function ownSubject(candidateId: string, subject: SubjectRef): Promise<{ subject: Subject; profile: { id: string; name: string } | null } | null> {
    if (subject.kind === "menu") return { subject: { ...subject, name: MENU_NAMES[subject.id] }, profile: null };
    const { rows } = await database.query<Partial<SubjectRow>>(OWN_SUBJECT[subject.kind], [subject.id, candidateId]);
    const row = rows[0];
    if (!row) return null;
    const named = subjectFrom({ ...NO_SUBJECT, ...row });
    return named ? { subject: named, profile: row.profile_id && row.profile_name ? { id: row.profile_id, name: row.profile_name } : null } : null;
  }

  /**
   * The last `limit` messages of the Candidate's conversation, oldest first, each reply with its Job Offer card;
   * `forCoach`: without the stopped questions the input Guardrails never let through, which the AI Coach must never be sent.
   */
  async function lastMessages(candidateId: string, conversationId: string, limit: number | null, forCoach = false): Promise<CoachMessage[]> {
    const { rows } = await database.query<MessageRow>(
      `SELECT recent.author AS "from", recent.text, recent.blocked,
              CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object('id', o.id, 'title', o.title, 'employer', o.employer, 'followed', a.id IS NOT NULL)) END AS "jobOffer",
              ${SAVED_REPLY_COLUMNS.replaceAll("m.", "recent.")}
         FROM (SELECT * FROM coach_message WHERE conversation_id = $1 ${forCoach ? "AND NOT unchecked" : ""} ORDER BY seq DESC LIMIT $2) recent
         LEFT JOIN job_offer o ON o.id = recent.job_offer_id
         LEFT JOIN application a ON a.job_offer_id = o.id AND a.candidate_id = $3
        ORDER BY recent.seq`,
      [conversationId, limit, candidateId],
    );
    return rows.map((row) => ({
      from: row.from,
      text: row.text,
      ...(row.blocked ? { blocked: true as const } : {}),
      ...(row.jobOffer ? { jobOffer: row.jobOffer } : {}),
      ...(row.from === "coach" ? { provenance: savedReplyProvenance(row), at: row.at.toISOString() } : {}),
    }));
  }

  /** The Job Offer card of a reply's Job Offer, as the Candidate sees it now. */
  async function cardOf(candidateId: string, jobOffer: Pick<JobOffer, "id" | "title" | "employer">): Promise<JobOfferCard> {
    const { rows } = await database.query(`SELECT 1 FROM application WHERE candidate_id = $1 AND job_offer_id = $2`, [candidateId, jobOffer.id]);
    return { id: jobOffer.id, title: jobOffer.title, ...(jobOffer.employer ? { employer: jobOffer.employer } : {}), followed: rows.length > 0 };
  }

  /**
   * Each conversation's latest send, until it has saved what it saves (#328). A message sent while the one before is still
   * being answered or saved, right after a Stop, waits for it: it then follows it in the conversation, which for a new
   * conversation only exists once that first message is saved. Within this server process: the app runs one.
   */
  const sending = new Map<string, Promise<unknown>>();
  function inTurn<T>(conversationId: string, run: () => Promise<T>): Promise<T> {
    const turn = (sending.get(conversationId) ?? Promise.resolve()).then(run);
    const done = turn.catch(() => undefined);
    sending.set(conversationId, done);
    void done.then(() => {
      if (sending.get(conversationId) === done) sending.delete(conversationId);
    });
    return turn;
  }

  return {
    async send(candidateId, input, options = {}) {
      const parsed = sendSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const { conversationId, subject, message, focus, helpArticle, route } = parsed.data;
      if (conversationId && subject) return { ok: false, error: "invalid" };
      // A new conversation gets its id now, so a Stop keeps the message in the conversation the Candidate was told of.
      const id = conversationId ?? randomUUID();
      // Messages about one Subject take turns, so its first two make one conversation, not two.
      return inTurn(subject ? `${candidateId}:${subject.kind}:${subject.id}` : id, async (): Promise<SendResult> => {
        const { signal, onEvent } = options;
        const emit = (event: CoachEvent) => {
          try {
            onEvent?.(event);
          } catch {
            // The live view is a convenience: the reply goes on without it.
          }
        };

        const owned = subject ? await ownSubject(candidateId, subject) : null;
        if (subject && !owned) return { ok: false, error: "not_found" };
        const ofSubject = subject ? await findOfSubject(candidateId, subject) : null;
        const existing = conversationId ? await find(candidateId, conversationId) : ofSubject ? summaryFrom(ofSubject) : null;
        if (conversationId && !existing) return { ok: false, error: "not_found" };
        const history = existing ? await lastMessages(candidateId, existing.id, MAX_MESSAGES, true) : [];
        const profile = existing ? null : owned ? owned.profile : await profileInView(candidateId, focus);
        const conversation: CoachConversationSummary = existing ?? { id, title: titleFrom(message), subject: owned?.subject ?? null, profile, lastMessageAt: now() };
        emit({ type: "conversation", conversation });
        const replyFocus = focusFor(conversation.subject, focus);

        const answer = await deps.coach.reply(
          candidateId,
          {
            messages: [...withoutBlockedMessages(history).map(({ from, text }) => ({ from, text })), { from: "candidate", text: message }],
            ...(replyFocus ? { focus: replyFocus } : {}),
            ...(helpArticle ? { helpArticle: { id: helpArticle.id } } : {}),
          },
          { ...(options.language ? { language: options.language } : {}), ...(signal ? { signal } : {}), ...(onEvent ? { onEvent: emit } : {}) },
        );
        if (!answer.ok && answer.error !== "stopped") return answer;
        if (!answer.ok || signal?.aborted) {
          // Stopped, even once the reply came back: nothing is saved as a reply (#316 answer 11), the question stays. Shown, never
          // blocked, but kept from the AI Coach unless the input Guardrails had let it through: else a Stop would get round them.
          const passed = answer.ok ? answer.outcome === "replied" || answer.outcome === "blocked_reply" : answer.messagePassed;
          await save(candidateId, conversation, !existing, { message, blocked: false, unchecked: !passed }, null, now());
          const saved = await find(candidateId, conversation.id);
          return saved ? { ok: false, error: "stopped", conversation: saved } : { ok: false, error: "not_found" };
        }

        const sentAt = now();
        const blocked = { message: answer.outcome === "blocked_message", reply: answer.outcome === "blocked_message" || answer.outcome === "blocked_reply" };
        await save(candidateId, conversation, !existing, { message, blocked: blocked.message }, { answer, blocked: blocked.reply, focus: replyFocus }, sentAt);
        const saved = await find(candidateId, conversation.id);
        if (!saved) return { ok: false, error: "not_found" }; // deleted meanwhile
        await deps.unansweredQuestions
          ?.notice(candidateId, {
            question: message,
            reply: { text: answer.reply, outcome: answer.outcome, ...(answer.aboutJobbbox !== undefined ? { aboutJobbbox: answer.aboutJobbbox } : {}) },
            ...(route !== undefined ? { route } : {}),
            language: options.language ?? "fr",
          })
          .catch((error: unknown) => console.warn("[coach-conversations] an Unanswered Question could not be recorded:", error instanceof Error ? error.message : error));
        return {
          ok: true,
          conversation: saved,
          reply: answer.reply,
          blocked,
          ...(answer.jobOffer ? { jobOffer: await cardOf(candidateId, answer.jobOffer) } : {}),
          provenance: answer.provenance,
          at: sentAt.toISOString(),
          couldNotAnswer: answer.couldNotAnswer === true,
        };
      });
    },

    async list(candidateId) {
      const { rows } = await database.query<ConversationRow>(`${SUMMARY} WHERE c.candidate_id = $1 ORDER BY c.last_message_at DESC, c.created_at DESC`, [
        candidateId,
      ]);
      return rows.map(summaryFrom);
    },

    async open(candidateId, conversationId) {
      const row = await findRow(candidateId, conversationId);
      if (!row) return null;
      return { ...summaryFrom(row), aiDisclosure: row.ai_disclosure, messages: await lastMessages(candidateId, row.id, null) };
    },

    async ofSubject(candidateId, input) {
      const parsed = subjectSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      if (!(await ownSubject(candidateId, parsed.data))) return { ok: false, error: "not_found" };
      const row = await findOfSubject(candidateId, parsed.data);
      if (!row) return { ok: true, conversation: null };
      return { ok: true, conversation: { ...summaryFrom(row), aiDisclosure: row.ai_disclosure, messages: await lastMessages(candidateId, row.id, null) } };
    },

    async rename(candidateId, conversationId, title) {
      const parsed = titleSchema.safeParse(title);
      if (!parsed.success) return { ok: false, error: "invalid" };
      if (!UUID.test(conversationId)) return { ok: false, error: "not_found" };
      const { rowCount } = await database.query(`UPDATE coach_conversation SET title = $3 WHERE id = $1 AND candidate_id = $2`, [
        conversationId,
        candidateId,
        parsed.data,
      ]);
      const conversation = rowCount ? await find(candidateId, conversationId) : null;
      return conversation ? { ok: true, conversation } : { ok: false, error: "not_found" };
    },

    async repliesAbout(candidateId, about) {
      const focus = focusOf(about);
      if (!focus) return [];
      const { rows } = await database.query<SavedReply>(
        `SELECT ${SAVED_REPLY_COLUMNS}
           FROM coach_message m JOIN coach_conversation c ON c.id = m.conversation_id
          WHERE c.candidate_id = $1 AND m.author = 'coach' AND m.focus_kind = $2 AND m.focus_id IS NOT DISTINCT FROM $3::uuid
          ORDER BY m.created_at, m.seq`,
        [candidateId, focus.kind, focus.kind === "agenda" ? null : focus.id],
      );
      return rows.map((row) => ({ at: row.at.toISOString(), provenance: savedReplyProvenance(row) }));
    },

    async delete(candidateId, conversationId) {
      if (!UUID.test(conversationId)) return false;
      const { rowCount } = await database.query(`DELETE FROM coach_conversation WHERE id = $1 AND candidate_id = $2`, [conversationId, candidateId]);
      return rowCount === 1;
    },
  };

  /**
   * Saves the Candidate's message and the AI Coach's reply together, `reply` null when it was stopped, with the conversation
   * when it is `isNew`; the conversation's last message is then `sentAt`.
   */
  async function save(
    candidateId: string,
    conversation: CoachConversationSummary,
    isNew: boolean,
    asked: { message: string; blocked: boolean; unchecked?: boolean },
    reply: { answer: Extract<CoachReply, { ok: true }>; blocked: boolean; focus: Focus | null } | null,
    sentAt: Date,
  ): Promise<void> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const { id, subject } = conversation;
      if (isNew) {
        const subjectId = (kind: SubjectRef["kind"]) => (subject?.kind === kind ? subject.id : null);
        await client.query(
          `INSERT INTO coach_conversation (id, candidate_id, profile_id, title, created_at, last_message_at, ai_disclosure, subject_kind, subject_menu, application_id, job_search_id, job_digest_id)
           VALUES ($1, $2, $3, $4, $5, $5, true, $6, $7, $8, $9, $10)`,
          [id, candidateId, conversation.profile?.id ?? subjectId("profile"), conversation.title, sentAt, subject?.kind ?? null, subjectId("menu"), subjectId("application"), subjectId("job_search"), subjectId("job_digest")],
        );
      }
      await client.query(`INSERT INTO coach_message (conversation_id, author, text, created_at, blocked, unchecked) VALUES ($1, 'candidate', $2, $3, $4, $5)`, [
        id,
        asked.message,
        sentAt,
        asked.blocked,
        asked.unchecked ?? false,
      ]);
      if (reply) {
        const { answer } = reply;
        const { cost } = answer;
        await client.query(
          `INSERT INTO coach_message (conversation_id, author, text, created_at, provider, model, input_tokens, output_tokens, cached_input_tokens, cost_eur, playbooks, consultations, blocked, job_offer_id,
                                     provenance, focus_kind, focus_id)
           VALUES ($1, 'coach', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            id,
            answer.reply,
            sentAt,
            cost?.provider ?? null,
            cost?.model ?? null,
            cost?.inputTokens ?? null,
            cost?.outputTokens ?? null,
            cost?.cachedInputTokens ?? null,
            cost?.eur ?? null,
            JSON.stringify(answer.playbooks),
            JSON.stringify(answer.consultations),
            reply.blocked,
            answer.jobOffer?.id ?? null,
            JSON.stringify(answer.provenance),
            reply.focus?.kind ?? null,
            reply.focus && reply.focus.kind !== "agenda" ? reply.focus.id : null,
          ],
        );
      }
      await client.query(`UPDATE coach_conversation SET last_message_at = $2 WHERE id = $1`, [id, sentAt]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** The Profile in view, or the one the page in view shows, if it is the Candidate's: the one a new conversation is attached to. */
  async function profileInView(candidateId: string, focus: FocusInput): Promise<{ id: string; name: string } | null> {
    const profileId = focus?.kind === "profile" ? focus.id : focus?.profileId;
    if (!profileId) return null;
    const profile = await deps.profiles.get(candidateId, profileId);
    return profile ? { id: profile.id, name: profile.name } : null;
  }
}

/** The conversation without its Blocked messages: a blocked Candidate message and the Guardrail message that answered it. */
function withoutBlockedMessages(messages: CoachMessage[]): CoachMessage[] {
  return messages.filter((message, index) => {
    if (message.from === "candidate") return !message.blocked;
    const asked = messages[index - 1];
    return !(asked?.from === "candidate" && asked.blocked);
  });
}

/** The most one AI Coach reply should cost, in € (#122). */
export const COACH_MESSAGE_COST_TARGET_EUR = 0.03;

/** What the AI Coach's replies cost on one day, Paris time. */
export interface CoachCostDay {
  /** "2026-10-14". */
  day: string;
  /** AI Coach replies that day. */
  messages: number;
  /** Median and 90th percentile of the estimated cost of one reply, in € (interpolated). */
  medianEur: number;
  p90Eur: number;
  /** Tokens of all that day's replies: input not cached, output, cached input. */
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Who answered, most replies first. */
  models: { provider: CoachMessageCost["provider"]; model: string; messages: number }[];
  /** The Coaching Playbooks and Core Digest the replies drew on, per version, most replies first. */
  playbooks: (PlaybookUsed & { messages: number })[];
}

/**
 * The cost of the AI Coach's replies per day (Paris time) from `since` on, newest day first.
 * Costs are estimates at list prices, frozen when each reply was saved. Replies of deleted
 * Coach Conversations are gone with them.
 */
export async function coachCostPerDay(database: Pick<Pool, "query">, since: Date): Promise<CoachCostDay[]> {
  const { rows } = await database.query<CoachCostDay>(
    `WITH costed AS (
       SELECT to_char(created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day, provider, model,
              input_tokens, output_tokens, cached_input_tokens, cost_eur, playbooks
         FROM coach_message WHERE author = 'coach' AND cost_eur IS NOT NULL AND created_at >= $1
     ), models AS (
       SELECT day, jsonb_agg(jsonb_build_object('provider', provider, 'model', model, 'messages', messages) ORDER BY messages DESC, provider, model) AS models
         FROM (SELECT day, provider, model, count(*)::int AS messages FROM costed GROUP BY day, provider, model) per_model
        GROUP BY day
     ), playbooks AS (
       SELECT day, jsonb_agg(jsonb_build_object('id', id, 'version', version, 'messages', messages) ORDER BY messages DESC, id, version) AS playbooks
         FROM (SELECT day, used ->> 'id' AS id, used ->> 'version' AS version, count(*)::int AS messages
                 FROM costed, jsonb_array_elements(coalesce(costed.playbooks, '[]'::jsonb)) used
                GROUP BY day, used ->> 'id', used ->> 'version') per_playbook
        GROUP BY day
     )
     SELECT c.day, count(*)::int AS messages,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY c.cost_eur) AS "medianEur",
            percentile_cont(0.9) WITHIN GROUP (ORDER BY c.cost_eur) AS "p90Eur",
            sum(c.input_tokens)::float8 AS "inputTokens", sum(c.output_tokens)::float8 AS "outputTokens",
            sum(c.cached_input_tokens)::float8 AS "cachedInputTokens", m.models, coalesce(p.playbooks, '[]'::jsonb) AS playbooks
       FROM costed c JOIN models m USING (day) LEFT JOIN playbooks p USING (day)
      GROUP BY c.day, m.models, p.playbooks
      ORDER BY c.day DESC`,
    [since],
  );
  return rows;
}

/** What one Playbook Agent's consultations cost over a period. */
export interface PlaybookAgentCost {
  playbookId: string;
  consultations: number;
  /** Median estimated cost of one consultation, in € (interpolated). */
  medianEur: number;
  /** Who answered, most consultations first. */
  models: { provider: PlaybookConsultation["provider"]; model: string; consultations: number }[];
}

/**
 * The cost of each Playbook Agent's consultations from `since` on (#225), most consulted first.
 * Estimates at list prices, frozen when each reply was saved; already counted in each reply's cost.
 */
export async function coachCostPerPlaybookAgent(database: Pick<Pool, "query">, since: Date): Promise<PlaybookAgentCost[]> {
  const { rows } = await database.query<PlaybookAgentCost>(
    `WITH consulted AS (
       SELECT c ->> 'playbookId' AS playbook_id, c ->> 'provider' AS provider, c ->> 'model' AS model, (c ->> 'eur')::float8 AS eur
         FROM coach_message m, jsonb_array_elements(m.consultations) c
        WHERE m.author = 'coach' AND m.consultations IS NOT NULL AND m.created_at >= $1
     ), models AS (
       SELECT playbook_id, jsonb_agg(jsonb_build_object('provider', provider, 'model', model, 'consultations', n) ORDER BY n DESC, provider, model) AS models
         FROM (SELECT playbook_id, provider, model, count(*)::int AS n FROM consulted GROUP BY playbook_id, provider, model) per_model
        GROUP BY playbook_id
     )
     SELECT c.playbook_id AS "playbookId", count(*)::int AS consultations,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY c.eur) AS "medianEur", m.models
       FROM consulted c JOIN models m USING (playbook_id)
      GROUP BY c.playbook_id, m.models
      ORDER BY consultations DESC, c.playbook_id`,
    [since],
  );
  return rows;
}

/** How long a Coach Conversation is kept after its last message. */
export const RETENTION_MONTHS = 12;

/**
 * Deletes the Coach Conversations whose last message is RETENTION_MONTHS old or
 * more at `now`, with their messages; returns how many. Safe to run again.
 */
export async function purgeStaleCoachConversations(database: Pick<Pool, "query">, now: Date): Promise<number> {
  const { rowCount } = await database.query(`DELETE FROM coach_conversation WHERE last_message_at <= $1::timestamptz - make_interval(months => $2)`, [
    now,
    RETENTION_MONTHS,
  ]);
  return rowCount ?? 0;
}

/** Creates or upgrades the Coach Conversation tables. Run after the Profile, Job Offer, Application, Job Search and Job Digest tables. Safe to run repeatedly. */
export async function migrateCoachConversations(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS coach_conversation (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      profile_id uuid REFERENCES profile (id) ON DELETE CASCADE,
      title text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_message_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS coach_conversation_candidate_idx ON coach_conversation (candidate_id, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS coach_conversation_last_message_idx ON coach_conversation (last_message_at);
    CREATE TABLE IF NOT EXISTS coach_message (
      seq bigserial PRIMARY KEY,
      conversation_id uuid NOT NULL REFERENCES coach_conversation (id) ON DELETE CASCADE,
      author text NOT NULL CHECK (author IN ('candidate', 'coach')),
      text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS coach_message_conversation_idx ON coach_message (conversation_id, seq);
    -- What each AI Coach message cost (#127); null on the Candidate's messages and on replies saved before.
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS provider text;
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS model text;
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS input_tokens integer;
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS output_tokens integer;
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS cached_input_tokens integer;
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS cost_eur double precision;
    CREATE INDEX IF NOT EXISTS coach_message_costed_idx ON coach_message (created_at) WHERE cost_eur IS NOT NULL;
    -- The Coaching Playbooks and Core Digest each AI Coach message drew on, [{ id, version }] (#129);
    -- null on the Candidate's messages and on replies saved before.
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS playbooks jsonb;
    -- The Playbook Agents each AI Coach message consulted, with what each cost (#225); null before.
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS consultations jsonb;
    -- A Blocked message (#228): a Candidate message a Guardrail stopped, or the Guardrail message answering it or replacing a reply.
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;
    -- The Job Offer an AI Coach reply read from a link the Candidate pasted, shown as its Job Offer card; null otherwise.
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS job_offer_id uuid REFERENCES job_offer (id) ON DELETE SET NULL;
    -- What served each AI Coach reply (ADR-0034, #327): its Provenance, null before (a partial one is read from provider, model and tokens).
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS provenance jsonb;
    -- A reply's Focus (#327; six kinds since #600): the Subject's object, or what was In view when it was asked; the Agenda has no id.
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS focus_kind text;
    ALTER TABLE coach_message DROP CONSTRAINT IF EXISTS coach_message_focus_kind_check;
    ALTER TABLE coach_message ADD CONSTRAINT coach_message_focus_kind_check CHECK (focus_kind IN (${FOCUS_KINDS.map((kind) => `'${kind}'`).join(", ")}));
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS focus_id uuid;
    CREATE INDEX IF NOT EXISTS coach_message_focus_idx ON coach_message (focus_kind, focus_id) WHERE focus_id IS NOT NULL;
    -- A question the Candidate stopped before the input Guardrails let it through (#328): shown, never sent to the AI Coach.
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS unchecked boolean NOT NULL DEFAULT false;
    -- Whether the conversation opened with the AI disclosure (#324): true for every new one, false for those saved before.
    ALTER TABLE coach_conversation ADD COLUMN IF NOT EXISTS ai_disclosure boolean NOT NULL DEFAULT false;
    -- The conversations saved before they had a Subject are deleted, once, as it ships (ADR-0070): attached to a Profile with mixed
    -- Focus, they could not be split, and only staging held any. Their messages go with them; the Coach Memory is kept.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = current_schema() AND table_name = 'coach_conversation' AND column_name = 'subject_kind') THEN
        DELETE FROM coach_conversation;
      END IF;
    END $$;
    -- Its Subject (ADR-0070, #600): an object (its own column), a Sidebar menu, or none (a Free conversation, kind null).
    -- An archived object keeps its conversation; a deleted one takes it along.
    ALTER TABLE coach_conversation ADD COLUMN IF NOT EXISTS subject_kind text CHECK (subject_kind IN ('application', 'profile', 'job_search', 'job_digest', 'menu'));
    ALTER TABLE coach_conversation ADD COLUMN IF NOT EXISTS subject_menu text CHECK (subject_menu IN (${SUBJECT_MENUS.map((menu) => `'${menu}'`).join(", ")}));
    ALTER TABLE coach_conversation ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES application (id) ON DELETE CASCADE;
    ALTER TABLE coach_conversation ADD COLUMN IF NOT EXISTS job_search_id uuid REFERENCES job_search (id) ON DELETE CASCADE;
    ALTER TABLE coach_conversation ADD COLUMN IF NOT EXISTS job_digest_id uuid REFERENCES job_digest (id) ON DELETE CASCADE;
    ALTER TABLE coach_conversation DROP CONSTRAINT IF EXISTS coach_conversation_subject_check;
    ALTER TABLE coach_conversation ADD CONSTRAINT coach_conversation_subject_check CHECK (CASE subject_kind
      WHEN 'application' THEN application_id IS NOT NULL WHEN 'profile' THEN profile_id IS NOT NULL WHEN 'job_search' THEN job_search_id IS NOT NULL
      WHEN 'job_digest' THEN job_digest_id IS NOT NULL WHEN 'menu' THEN subject_menu IS NOT NULL ELSE true END);
    -- An object or a menu has at most one conversation.
    CREATE UNIQUE INDEX IF NOT EXISTS coach_conversation_subject_idx
      ON coach_conversation (candidate_id, subject_kind, (coalesce(application_id::text, job_search_id::text, job_digest_id::text, subject_menu, profile_id::text)))
      WHERE subject_kind IS NOT NULL;
  `);
}
