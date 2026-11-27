/**
 * Signalements (#278, #374): what a signed-in Candidate sends the Jobbbox team from the app (a Bug, an Idée, or a
 * Question after help that did not satisfy them). Each keeps whether its form showed the AI notice (#1139, ADR-0118):
 * only those sent with it reach Signalement triage (`triageable`, redacted by signalements/triage); the others are
 * read by people only, never sent to an AI (#283).
 *
 * One deep module in front of Postgres. `createSignalements(database, { version })` answers:
 *  - `send` one: checks its type and message, keeps its context (the page's path without query or `#…`, the
 *    Jobbbox version, the browser parsed to « Chrome 141, Mac » or, from the Jobbbox app, its version and system
 *    (« App Jobbbox 1.4.0, iOS 18.6 »), the Interface Language and the Text Size; never the raw user agent), and refuses an (SENDING_LIMIT + 1)th within a rolling SENDING_WINDOW_HOURS, counted in the
 *    database. A Question carries a copy of the Candidate's question and the coach's reply, never a link to the Coach
 *    Conversation, so it stays readable once that conversation is deleted;
 *  - `changeStatus` and `reply`, the team's side (the Back Office, #376), on its transaction: any status in any
 *    direction, but a Question is marked `traite` only once it has a reply; one reply, editable until `traite`;
 *  - `list`, `one` and `countToHandle`, what the team reads (#376): oldest first, of some types and statuses, each with
 *    the Candidate's email and Plan and, for a status an Agent Key set, its signature (`key:triage-beta`); and how many
 *    are « à traiter » (TO_HANDLE_STATUSES);
 *  - `triageable` and `triageableOne`, what Signalement triage may read (#1139): only those sent with the AI notice,
 *    each with its Candidate's id, which signalements/triage uses for Redaction and never returns, and what triage
 *    already did (#1173): who set its status, the first issue linked, its draft's signature and date, never its text;
 *    and `whyNotTriageable`, why an id is none of them (TRIAGE_MISSING_REASONS): a Signalement sent with the AI notice
 *    leaves, once deleted or purged, a trace of its id, when and why (`signalement_removed`), nothing of the Candidate,
 *    purged RETENTION_MONTHS later;
 *  - `linkIssue`, `saveDraft`, `removeDraft`, `sendDraft`, `markReadyToClose`, `issuesToCheck` and `markIssuesChecked`,
 *    Signalement triage's follow-up (#1141, ADR-0118): the issue numbers Jobbbox published or commented for it, kept
 *    for the team (and in the Data export, by number alone); the draft reply an Agent Key proposed, in French and in
 *    English, which Support edits, deletes or sends (the Candidate's language as the reply, and `traite` with it: one
 *    Signalement notification); « Prêt à clore », the team's alone, set together on every Signalement linked to an issue
 *    a deployed commit closed, and the issues still to check against the deployed commit;
 *  - `notifications`, `closeNotifications` and `remove`, the Candidate's side (#377): the Signalement notifications
 *    due (a reply saved or `traite` since they last closed it, derived from the row as it stands), closing one or all
 *    of them, and deleting one of their own;
 * and `signalementsOf(database, candidateId)` (the Candidate's own, for their Data export and « Mes signalements »),
 * `migrateSignalements(database)` and `purgeSignalements(database, now)` (the worker, nightly: RETENTION_MONTHS
 * after it was marked `traite`).
 *
 * Tied to the Candidate: deleted with their account (ON DELETE CASCADE, ADR-0010) and in their Data export. It never
 * names which Administrator changed its status or replied; the Back Office Audit does.
 *
 * The values (types, statuses, limits) are in ./values, the only list of each.
 */
import { FREE_PLAN, type Plan } from "@jobhub/shared";
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@jobhub/shared/i18n";
import { resolveTextSize, type TextSizeSetting } from "@jobhub/shared/design";
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import type { FieldError } from "../validation";
import { pagePath, whereSentFrom } from "./context";
import {
  ATTACHED_MAX_LENGTH,
  ISSUE_LINK_KINDS,
  type DraftLanguage,
  type IssueLinkKind,
  isSignalementStatus,
  isSignalementType,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MIN_LENGTH,
  REPLY_MAX_LENGTH,
  REMOVAL_REASONS,
  type RemovalReason,
  RETENTION_MONTHS,
  SENDING_LIMIT,
  SENDING_WINDOW_HOURS,
  SIGNALEMENT_STATUSES,
  SIGNALEMENT_TYPES,
  TO_HANDLE_STATUSES,
  type SignalementStatus,
  type SignalementType,
  type TriageMissingReason,
} from "./values";
import { utcBefore } from "../database/before";

export * from "./values";

/** Where a Signalement was sent from, as it is kept. */
export interface SignalementContext {
  /** The page's path, without query string or `#…`; null when it was not known. */
  path: string | null;
  /** The Jobbbox version that served it. */
  version: string;
  /** « Chrome 141, Mac », or « App Jobbbox 1.4.0, iOS 18.6 » from the Jobbbox app (#690); null when the browser said nothing. */
  browser: string | null;
  interfaceLanguage: Locale;
  textSize: TextSizeSetting;
}

export interface Signalement {
  id: string;
  type: SignalementType;
  message: string;
  /** For a Question only: the Candidate's question to the coach and the coach's reply, copied. Null otherwise. */
  attachedQuestion: string | null;
  attachedCoachReply: string | null;
  context: SignalementContext;
  /** Whether its form said « Un outil d'IA peut lire votre message… » (#1139): false for those sent before the notice. */
  aiNoticeShown: boolean;
  status: SignalementStatus;
  /** When its status last changed; null while `nouveau` from the start. */
  statusChangedAt: Date | null;
  /** The team's reply, signed « L'équipe Jobbbox », never with an Administrator's name; null while there is none. */
  reply: string | null;
  /** When the reply was first saved; null while there is none, or for one saved without it. */
  repliedAt: Date | null;
  /** When the reply was last saved: later than `repliedAt` once it was changed. */
  replyUpdatedAt: Date | null;
  createdAt: Date;
}

/** An issue Signalement triage linked to a Signalement (#1141): opened for it by Jobbbox, or commented as a duplicate. */
export interface SignalementIssue {
  number: number;
  kind: IssueLinkKind;
  linkedAt: Date;
  /** The Agent Key that proposed it (`key:triage-beta`). Never in the Data export. */
  linkedBy: string;
}

/**
 * The draft reply Signalement triage proposed (#1141): in French and in English, one of them the Candidate's Interface
 * Language, which Support edits, deletes or sends. Never sent by the agent, never in the Data export.
 */
export interface SignalementDraft {
  fr: string;
  en: string;
  /** « Brouillon proposé par triage-beta »: the Agent Key that proposed it; null for one Support wrote. */
  proposedBy: string | null;
  proposedAt: Date;
  /** When Support last edited it; null while it is as proposed. */
  editedAt: Date | null;
  /** The version the Candidate would receive: the one in their Interface Language. */
  forCandidate: string;
}

/** A Signalement as the team reads it (#376): with who sent it, by the Candidate's email and current Plan. */
export interface SentSignalement extends Signalement {
  candidate: { email: string; plan: Plan };
  /** Who set its status when an Agent Key did (`key:triage-beta`, #1139); null when the team did. Never in the Data export. */
  statusChangedBy: string | null;
  /** The issues linked to it, in the order they were (#1141); the Candidate never sees them in « Mes signalements ». */
  issues: SignalementIssue[];
  /** The draft reply waiting for Support; null without one. */
  draft: SignalementDraft | null;
  /** « Prêt à clore » (#1141): when a deployed commit closed one of its issues in its environment; null until then. The team's alone. */
  readyToCloseAt: Date | null;
}

/** A Signalement as its Candidate has it (« Mes signalements », their Data export): with the numbers of its issues alone (#1141). */
export interface OwnSignalement extends Signalement {
  issueNumbers: number[];
}

/** What the Livraison email counts of the Signalements (#1141). */
export interface SignalementCounts {
  newByType: Record<SignalementType, number>;
  issues: { number: number; kind: IssueLinkKind; signalements: number }[];
  readyWithDraft: number;
}

/** What `saveDraft` and `sendDraft` refuse or answer. */
export type SaveDraftResult = { ok: true; draft: SignalementDraft } | { ok: false; errors: FieldError[] } | { ok: false; refused: "already_handled" };

/** A Signalement Signalement triage may read (#1139): sent with the AI notice, with its Candidate's id for Redaction only. */
export interface TriageableSignalement {
  candidateId: string;
  signalement: Signalement;
  /** Who set its status when an Agent Key did (`key:triage-beta`); null when the team did, or it is `nouveau` from the start. */
  statusChangedBy: string | null;
  /** The first issue linked to it (#1173); null for none. */
  issueNumber: number | null;
  /** Its draft reply's signature and date (#1173), never its text; null for none. */
  draft: { proposedBy: string | null; proposedAt: Date } | null;
}

/** Which Signalements the team reads: of these types and statuses (default: every one). */
export interface SignalementsFilter {
  types?: readonly SignalementType[];
  statuses?: readonly SignalementStatus[];
}

/** What the request says of where it comes from: the server's knowledge, never the sent body's. */
export interface SendingContext {
  /** The request's User-Agent header, read to name the browser and then dropped. */
  userAgent: string | null;
  /** What the Jobbbox app states of its version and system (APP_DEVICE_HEADER, #690); its native fetch's user agent names neither. */
  appDevice?: string | null;
  /** The signed-in Candidate's Interface Language. */
  interfaceLanguage: string;
}

export type SendResult =
  | { ok: true; signalement: Signalement }
  | { ok: false; errors: FieldError[] }
  /** SENDING_LIMIT already sent in the last SENDING_WINDOW_HOURS: « Vous avez envoyé beaucoup de signalements aujourd'hui, réessayez demain ». */
  | { ok: false; refused: "too_many" };

export interface Signalements {
  /**
   * Sends `sent` ({ type, message, path, textSize, attachedQuestion?, attachedCoachReply? }, as the dialog posts it)
   * for the Candidate. The message is trimmed; a Bug's or an Idée's attachments are ignored.
   */
  send(candidateId: string, sent: unknown, context: SendingContext): Promise<SendResult>;
  /**
   * Sets its status, dated when it changes, on `within` (the Back Office's transaction), signed `by` an Agent Key
   * (`key:triage-beta`, #1139) or, without it, by the team. Null for no such Signalement or status. A Question without
   * a reply cannot be marked `traite`.
   */
  changeStatus(id: string, status: SignalementStatus, within?: Queryable, by?: string): Promise<Changed | { refused: "reply_required" } | null>;
  /** Saves the team's reply (trimmed, at most REPLY_MAX_LENGTH), dated, on `within`. Null for no such Signalement; refused once it is `traite`. */
  reply(id: string, text: unknown, within?: Queryable): Promise<Changed | { errors: FieldError[] } | { refused: "already_handled" } | null>;
  /** The team's list: those of `filter`'s types and statuses, oldest first. Changes nothing. */
  list(filter?: SignalementsFilter): Promise<SentSignalement[]>;
  /** One of them, in full; null for no such Signalement. Changes nothing: opening one does not mark it `vu`. */
  one(id: string): Promise<SentSignalement | null>;
  /** How many are « à traiter » (TO_HANDLE_STATUSES): what the Back Office's sidebar shows next to Signalements. */
  countToHandle(): Promise<number>;
  /** Links the issue `number` to it, proposed `by` an Agent Key (#1141). Linking it again changes nothing. False for no such Signalement. */
  linkIssue(id: string, issue: { number: number; kind: IssueLinkKind }, by: string): Promise<boolean>;
  /**
   * Saves its draft reply ({ fr, en }, untrusted: each trimmed, at most REPLY_MAX_LENGTH) on `within`: proposed `by` an
   * Agent Key (`key:triage-beta`), replacing any draft; without `by`, edited by Support, keeping who proposed it.
   * Null for no such Signalement; refused once it is `traite`.
   */
  saveDraft(id: string, draft: unknown, options?: { by?: string; within?: Queryable }): Promise<SaveDraftResult | null>;
  /** Deletes its draft reply on `within`. False when there was none. */
  removeDraft(id: string, within?: Queryable): Promise<boolean>;
  /**
   * Sends its draft (#1141): the version in the Candidate's Interface Language becomes the reply, and it is marked
   * `traite` with it, so the Candidate gets one Signalement notification; the draft is gone. Null for no such
   * Signalement; refused without a draft, or once it is `traite`.
   */
  sendDraft(id: string, within?: Queryable): Promise<Changed | { refused: "no_draft" | "already_handled" } | null>;
  /** Marks « Prêt à clore » every Signalement linked to one of `issues` but those `traite` or already so; returns their ids. */
  markReadyToClose(issues: readonly number[]): Promise<string[]>;
  /** The issues linked to a Signalement not yet `traite` nor « Prêt à clore », not yet checked against the deployed `commit`, ascending. */
  issuesToCheck(commit: string): Promise<number[]>;
  /** Records that `issues` were checked against the deployed `commit`. */
  markIssuesChecked(issues: readonly number[], commit: string): Promise<void>;
  /**
   * What the Livraison email's « Signalements » section counts (#1141): those sent since `since`, by type; the issues
   * linked since, each opened (Jobbbox opened it for one of them) or commented (only completed with a duplicate), with how
   * many Signalements; and how many are « Prêt à clore » with a draft waiting for Support. Numbers only, never a text.
   */
  countsSince(since: Date): Promise<SignalementCounts>;
  /** Those sent with the AI notice, of `statuses` (default: every one), oldest first (#1139). Changes nothing. */
  triageable(filter?: { statuses?: readonly SignalementStatus[] }): Promise<TriageableSignalement[]>;
  /** One sent with the AI notice; null for any other (#1139). */
  triageableOne(id: string): Promise<TriageableSignalement | null>;
  /** Why `id` is not one `triageableOne` gives (#1173): from its trace once gone, else whether it exists without the AI notice. */
  whyNotTriageable(id: string): Promise<TriageMissingReason>;
  /**
   * The Candidate's Signalement notifications not closed yet, newest first (#377): one for each of their Signalements
   * the team replied to or marked `traite` since the Candidate last closed its notification (one even when both
   * happened). Being marked `vu` gives none. Derived from the Signalement as it stands, so a reply or status written
   * by any means notifies.
   */
  notifications(candidateId: string): Promise<SignalementNotification[]>;
  /**
   * Closes the notification of the Candidate's Signalement `id` (they closed it), or, without `id`, of every one of
   * theirs (they opened « Mes signalements »). A reply or `traite` saved afterwards notifies again. Nothing for anyone
   * else's.
   */
  closeNotifications(candidateId: string, id?: string): Promise<void>;
  /**
   * Deletes the Candidate's own Signalement `id` (« Mes signalements », #377): gone for the team too. The Back Office
   * Audit keeps only what it already held. False when they have no such Signalement.
   */
  remove(candidateId: string, id: string): Promise<boolean>;
}

/**
 * What every workspace page tells the Candidate of one of their Signalements (#377): « L'équipe Jobbbox a répondu à
 * votre signalement du 25 octobre » when it has a reply, else « Votre signalement du 25 octobre est traité ».
 */
export interface SignalementNotification {
  signalementId: string;
  /** ISO: when the Candidate sent it, the date the notification names. */
  sentAt: string;
  /** The team replied (else it was marked `traite` without a reply). */
  replied: boolean;
}

/** A Signalement before and after the team changed it: what the Back Office Audit records (#376). */
export interface Changed {
  before: Signalement;
  after: Signalement;
}

export interface SignalementsDeps {
  /** The Jobbbox version serving the request (the deployed revision). */
  version: string;
  /** Default: the system clock. */
  now?: () => Date;
}

interface Row {
  id: string;
  type: SignalementType;
  message: string;
  attached_question: string | null;
  attached_coach_reply: string | null;
  path: string | null;
  version: string;
  browser: string | null;
  interface_language: Locale;
  text_size: TextSizeSetting;
  ai_notice_shown: boolean;
  status: SignalementStatus;
  status_changed_at: Date | null;
  reply: string | null;
  replied_at: Date | null;
  reply_updated_at: Date | null;
  created_at: Date;
}

const COLUMNS = `id::text, type, message, attached_question, attached_coach_reply, path, version, browser, interface_language, text_size,
  ai_notice_shown, status, status_changed_at, reply, replied_at, reply_updated_at, created_at`;

interface SentRow extends Row {
  email: string;
  plan: Plan | null;
  status_changed_by: string | null;
  ready_to_close_at: Date | null;
  issues: { number: number; kind: IssueLinkKind; linkedAt: string; linkedBy: string }[];
  draft_fr: string | null;
  draft_en: string | null;
  draft_proposed_by: string | null;
  draft_proposed_at: Date | null;
  draft_edited_at: Date | null;
}

const prefixed = (prefix: string) => COLUMNS.split(",").map((column) => `${prefix}.${column.trim()}`).join(", ");

/** Its linked issues, in the order they were linked, as JSON. */
const ISSUES_OF = (signalement: string) => `(SELECT coalesce(json_agg(json_build_object('number', i.issue_number, 'kind', i.kind, 'linkedAt', i.linked_at, 'linkedBy', i.linked_by)
  ORDER BY i.linked_at, i.issue_number), '[]'::json) FROM signalement_issue i WHERE i.signalement_id = ${signalement})`;

/** The columns of `signalement s` with its Candidate's email and Plan, its issues and its draft, for SentRow. */
const SENT = `${prefixed("s")}, s.status_changed_by, s.ready_to_close_at, c.email, cp.plan, ${ISSUES_OF("s.id")} AS issues,
  d.fr AS draft_fr, d.en AS draft_en, d.proposed_by AS draft_proposed_by, d.proposed_at AS draft_proposed_at, d.edited_at AS draft_edited_at
  FROM signalement s JOIN candidate c ON c.id = s.candidate_id LEFT JOIN candidate_plan cp ON cp.candidate_id = s.candidate_id
  LEFT JOIN signalement_draft d ON d.signalement_id = s.id`;

interface DraftRow {
  fr: string;
  en: string;
  proposed_by: string | null;
  proposed_at: Date;
  edited_at: Date | null;
}

const draftFrom = (row: DraftRow, language: Locale): SignalementDraft => ({
  fr: row.fr,
  en: row.en,
  proposedBy: row.proposed_by,
  proposedAt: row.proposed_at,
  editedAt: row.edited_at,
  forCandidate: row[draftLanguage(language)],
});

/** The draft's language the Candidate reads: their Interface Language. */
const draftLanguage = (language: Locale): DraftLanguage => (language === "en" ? "en" : "fr");

const sentFrom = (row: SentRow): SentSignalement => ({
  ...fromRow(row),
  candidate: { email: row.email, plan: row.plan ?? FREE_PLAN },
  statusChangedBy: row.status_changed_by,
  issues: row.issues.map((issue) => ({ number: issue.number, kind: issue.kind, linkedAt: new Date(issue.linkedAt), linkedBy: issue.linkedBy })),
  draft:
    row.draft_fr !== null && row.draft_en !== null && row.draft_proposed_at !== null
      ? draftFrom({ fr: row.draft_fr, en: row.draft_en, proposed_by: row.draft_proposed_by, proposed_at: row.draft_proposed_at, edited_at: row.draft_edited_at }, row.interface_language)
      : null,
  readyToCloseAt: row.ready_to_close_at,
});

interface TriageableRow extends Row {
  candidate_id: string;
  status_changed_by: string | null;
  issue_number: number | null;
  draft_proposed_by: string | null;
  draft_proposed_at: Date | null;
}

/** The columns of `signalement s` with what triage already did: its first issue, its draft's signature and date, never its text. */
const TRIAGEABLE = `${prefixed("s")}, s.candidate_id, s.status_changed_by,
  (SELECT i.issue_number FROM signalement_issue i WHERE i.signalement_id = s.id ORDER BY i.linked_at, i.issue_number LIMIT 1) AS issue_number,
  d.proposed_by AS draft_proposed_by, d.proposed_at AS draft_proposed_at
  FROM signalement s LEFT JOIN signalement_draft d ON d.signalement_id = s.id`;

const triageableFrom = (row: TriageableRow): TriageableSignalement => ({
  candidateId: row.candidate_id,
  signalement: fromRow(row),
  statusChangedBy: row.status_changed_by,
  issueNumber: row.issue_number,
  draft: row.draft_proposed_at === null ? null : { proposedBy: row.draft_proposed_by, proposedAt: row.draft_proposed_at },
});

const fromRow = (row: Row): Signalement => ({
  id: row.id,
  type: row.type,
  message: row.message,
  attachedQuestion: row.attached_question,
  attachedCoachReply: row.attached_coach_reply,
  context: { path: row.path, version: row.version, browser: row.browser, interfaceLanguage: row.interface_language, textSize: row.text_size },
  aiNoticeShown: row.ai_notice_shown,
  status: row.status,
  statusChangedAt: row.status_changed_at,
  reply: row.reply,
  repliedAt: row.replied_at,
  replyUpdatedAt: row.reply_updated_at,
  createdAt: row.created_at,
});

/** A trimmed text field between `min` and `max` characters, or what to fix. */
function text(field: string, value: unknown, min: number, max: number): string | FieldError {
  if (value !== undefined && value !== null && typeof value !== "string") return { field, code: "invalid" };
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { field, code: "required" };
  if (trimmed.length < min) return { field, code: "too_short" };
  if (trimmed.length > max) return { field, code: "too_long" };
  return trimmed;
}

interface Checked {
  type: SignalementType;
  message: string;
  attachedQuestion: string | null;
  attachedCoachReply: string | null;
  path: string | null;
  textSize: TextSizeSetting;
  aiNoticeShown: boolean;
}

/** The Signalement to store, or the fields to fix. */
function checked(sent: unknown): Checked | FieldError[] {
  const body = (sent && typeof sent === "object" ? sent : {}) as Record<string, unknown>;
  const errors: FieldError[] = [];
  const type = isSignalementType(body.type) ? body.type : null;
  if (!type) errors.push({ field: "type", code: body.type === undefined ? "required" : "invalid" });
  const message = text("message", body.message, MESSAGE_MIN_LENGTH, MESSAGE_MAX_LENGTH);
  if (typeof message !== "string") errors.push(message);
  let attachedQuestion: string | FieldError | null = null;
  let attachedCoachReply: string | FieldError | null = null;
  if (type === "question") {
    attachedQuestion = text("attachedQuestion", body.attachedQuestion, 1, ATTACHED_MAX_LENGTH);
    attachedCoachReply = text("attachedCoachReply", body.attachedCoachReply, 1, ATTACHED_MAX_LENGTH);
    for (const attached of [attachedQuestion, attachedCoachReply]) if (typeof attached !== "string") errors.push(attached);
  }
  if (errors.length > 0 || !type || typeof message !== "string") return errors;
  return {
    type,
    message,
    attachedQuestion: attachedQuestion as string | null,
    attachedCoachReply: attachedCoachReply as string | null,
    path: pagePath(body.path),
    textSize: resolveTextSize(typeof body.textSize === "string" ? body.textSize : null).setting,
    // Only a form that showed the notice says so (#1139): one sent from an older form, or saying anything else, did not.
    aiNoticeShown: body.aiNotice === true,
  };
}

/**
 * A Signalement whose notification is due: replied to, or marked `traite`, after the Candidate last closed its
 * notification (never, while `notification_closed_at` is null).
 */
const NOTIFYING = `((reply IS NOT NULL AND (notification_closed_at IS NULL OR reply_updated_at > notification_closed_at))
  OR (status = 'traite' AND (notification_closed_at IS NULL OR status_changed_at > notification_closed_at)))`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createSignalements(database: Pool, deps: SignalementsDeps): Signalements {
  const now = deps.now ?? (() => new Date());

  /** The Signalement `id`, locked until `within`'s transaction ends; null for none. */
  async function locked(id: string, within: Queryable): Promise<Signalement | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await within.query<Row>(`SELECT ${COLUMNS} FROM signalement WHERE id = $1 FOR UPDATE`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  return {
    async send(candidateId, sent, context) {
      const signalement = checked(sent);
      if (Array.isArray(signalement)) return { ok: false, errors: signalement };
      const at = now();
      return inTransaction(database, async (client) => {
        // One sending at a time per Candidate, so two at once cannot both pass the limit.
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('signalement:' || $1, 0))`, [candidateId]);
        const { rows: counted } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM signalement WHERE candidate_id = $1 AND created_at > $2::timestamptz - make_interval(hours => $3)`,
          [candidateId, at, SENDING_WINDOW_HOURS],
        );
        if (counted[0]!.n >= SENDING_LIMIT) return { ok: false, refused: "too_many" } as const;
        const { rows } = await client.query<Row>(
          `INSERT INTO signalement (candidate_id, type, message, attached_question, attached_coach_reply, path, version, browser, interface_language, text_size, created_at, ai_notice_shown)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${COLUMNS}`,
          [
            candidateId,
            signalement.type,
            signalement.message,
            signalement.attachedQuestion,
            signalement.attachedCoachReply,
            signalement.path,
            deps.version,
            whereSentFrom(context),
            isSupportedLocale(context.interfaceLanguage) ? context.interfaceLanguage : DEFAULT_LOCALE,
            signalement.textSize,
            at,
            signalement.aiNoticeShown,
          ],
        );
        return { ok: true, signalement: fromRow(rows[0]!) } as const;
      });
    },

    async changeStatus(id, status, within = database, by) {
      if (!isSignalementStatus(status)) return null;
      const before = await locked(id, within);
      if (!before) return null;
      if (before.status === status) return { before, after: before };
      if (status === "traite" && before.type === "question" && !before.reply) return { refused: "reply_required" };
      const { rows } = await within.query<Row>(`UPDATE signalement SET status = $2, status_changed_at = $3, status_changed_by = $4 WHERE id = $1 RETURNING ${COLUMNS}`, [
        id,
        status,
        now(),
        by ?? null,
      ]);
      return { before, after: fromRow(rows[0]!) };
    },

    async reply(id, sent, within = database) {
      const reply = text("reply", sent, 1, REPLY_MAX_LENGTH);
      const before = await locked(id, within);
      if (!before) return null;
      if (before.status === "traite") return { refused: "already_handled" };
      if (typeof reply !== "string") return { errors: [reply] };
      const { rows } = await within.query<Row>(`UPDATE signalement SET reply = $2, replied_at = coalesce(replied_at, $3), reply_updated_at = $3 WHERE id = $1 RETURNING ${COLUMNS}`, [id, reply, now()]);
      return { before, after: fromRow(rows[0]!) };
    },

    async list({ types = SIGNALEMENT_TYPES, statuses = SIGNALEMENT_STATUSES } = {}) {
      const { rows } = await database.query<SentRow>(`SELECT ${SENT} WHERE s.type = ANY($1::text[]) AND s.status = ANY($2::text[]) ORDER BY s.created_at, s.id`, [types, statuses]);
      return rows.map(sentFrom);
    },

    async one(id) {
      if (!UUID.test(id)) return null;
      const { rows } = await database.query<SentRow>(`SELECT ${SENT} WHERE s.id = $1`, [id]);
      return rows[0] ? sentFrom(rows[0]) : null;
    },

    async notifications(candidateId) {
      const { rows } = await database.query<{ id: string; created_at: Date; replied: boolean }>(
        `SELECT id::text, created_at, reply IS NOT NULL AS replied FROM signalement WHERE candidate_id = $1 AND ${NOTIFYING}
         ORDER BY created_at DESC, id`,
        [candidateId],
      );
      return rows.map((row) => ({ signalementId: row.id, sentAt: row.created_at.toISOString(), replied: row.replied }));
    },

    async closeNotifications(candidateId, id) {
      if (id !== undefined && !UUID.test(id)) return;
      await database.query(
        `UPDATE signalement SET notification_closed_at = $2 WHERE candidate_id = $1 AND ($3::uuid IS NULL OR id = $3::uuid) AND ${NOTIFYING}`,
        [candidateId, now(), id ?? null],
      );
    },

    async remove(candidateId, id) {
      if (!UUID.test(id)) return false;
      const { rowCount } = await database.query(`DELETE FROM signalement WHERE id = $1 AND candidate_id = $2`, [id, candidateId]);
      return Boolean(rowCount);
    },

    async triageable({ statuses = SIGNALEMENT_STATUSES } = {}) {
      const { rows } = await database.query<TriageableRow>(`SELECT ${TRIAGEABLE} WHERE s.ai_notice_shown AND s.status = ANY($1::text[]) ORDER BY s.created_at, s.id`, [statuses]);
      return rows.map(triageableFrom);
    },

    async triageableOne(id) {
      if (!UUID.test(id)) return null;
      const { rows } = await database.query<TriageableRow>(`SELECT ${TRIAGEABLE} WHERE s.ai_notice_shown AND s.id = $1`, [id]);
      return rows[0] ? triageableFrom(rows[0]) : null;
    },

    async whyNotTriageable(id) {
      if (!UUID.test(id)) return "unknown";
      const { rows } = await database.query<{ removed: RemovalReason | null; notice: boolean | null }>(
        `SELECT (SELECT reason FROM signalement_removed WHERE id = $1) AS removed, (SELECT ai_notice_shown FROM signalement WHERE id = $1) AS notice`,
        [id],
      );
      const { removed, notice } = rows[0]!;
      if (notice === false) return "no_ai_notice";
      return notice === null && removed ? removed : "unknown";
    },

    async linkIssue(id, issue, by) {
      if (!UUID.test(id) || !Number.isInteger(issue.number) || issue.number < 1) return false;
      const { rows } = await database.query<{ found: boolean }>(
        `WITH linked AS (
           INSERT INTO signalement_issue (signalement_id, issue_number, kind, linked_at, linked_by)
           SELECT id, $2, $3, $4, $5 FROM signalement WHERE id = $1
           ON CONFLICT (signalement_id, issue_number) DO NOTHING)
         SELECT EXISTS (SELECT 1 FROM signalement WHERE id = $1) AS found`,
        [id, issue.number, issue.kind, now(), by],
      );
      return rows[0]!.found;
    },

    async saveDraft(id, sent, { by, within = database } = {}) {
      const body = (sent && typeof sent === "object" ? sent : {}) as Record<string, unknown>;
      const fr = text("fr", body.fr, 1, REPLY_MAX_LENGTH);
      const en = text("en", body.en, 1, REPLY_MAX_LENGTH);
      const before = await locked(id, within);
      if (!before) return null;
      if (before.status === "traite") return { ok: false, refused: "already_handled" };
      const errors = [fr, en].filter((each): each is FieldError => typeof each !== "string");
      if (errors.length > 0 || typeof fr !== "string" || typeof en !== "string") return { ok: false, errors };
      const { rows } = await within.query<DraftRow>(
        by === undefined
          ? `INSERT INTO signalement_draft (signalement_id, fr, en, proposed_by, proposed_at, edited_at) VALUES ($1, $2, $3, NULL, $4, $4)
             ON CONFLICT (signalement_id) DO UPDATE SET fr = EXCLUDED.fr, en = EXCLUDED.en, edited_at = EXCLUDED.edited_at
             RETURNING fr, en, proposed_by, proposed_at, edited_at`
          : `INSERT INTO signalement_draft (signalement_id, fr, en, proposed_by, proposed_at, edited_at) VALUES ($1, $2, $3, $5, $4, NULL)
             ON CONFLICT (signalement_id) DO UPDATE SET fr = EXCLUDED.fr, en = EXCLUDED.en, proposed_by = EXCLUDED.proposed_by, proposed_at = EXCLUDED.proposed_at, edited_at = NULL
             RETURNING fr, en, proposed_by, proposed_at, edited_at`,
        by === undefined ? [id, fr, en, now()] : [id, fr, en, now(), by],
      );
      return { ok: true, draft: draftFrom(rows[0]!, before.context.interfaceLanguage) };
    },

    async removeDraft(id, within = database) {
      if (!UUID.test(id)) return false;
      const { rowCount } = await within.query(`DELETE FROM signalement_draft WHERE signalement_id = $1`, [id]);
      return Boolean(rowCount);
    },

    async sendDraft(id, within = database) {
      const before = await locked(id, within);
      if (!before) return null;
      if (before.status === "traite") return { refused: "already_handled" };
      const { rows: drafts } = await within.query<DraftRow>(`DELETE FROM signalement_draft WHERE signalement_id = $1 RETURNING fr, en, proposed_by, proposed_at, edited_at`, [id]);
      if (!drafts[0]) return { refused: "no_draft" };
      const at = now();
      // The reply and « traité » in one write: the Candidate gets one Signalement notification for both.
      const { rows } = await within.query<Row>(
        `UPDATE signalement SET reply = $2, replied_at = coalesce(replied_at, $3), reply_updated_at = $3, status = 'traite', status_changed_at = $3, status_changed_by = NULL
          WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, drafts[0][draftLanguage(before.context.interfaceLanguage)], at],
      );
      return { before, after: fromRow(rows[0]!) };
    },

    async markReadyToClose(issues) {
      if (issues.length === 0) return [];
      const { rows } = await database.query<{ id: string }>(
        `UPDATE signalement SET ready_to_close_at = $2
          WHERE status <> 'traite' AND ready_to_close_at IS NULL
            AND id IN (SELECT signalement_id FROM signalement_issue WHERE issue_number = ANY($1::int[]))
          RETURNING id::text`,
        [issues, now()],
      );
      return rows.map((row) => row.id);
    },

    async issuesToCheck(commit) {
      const { rows } = await database.query<{ issue_number: number }>(
        `SELECT DISTINCT i.issue_number FROM signalement_issue i JOIN signalement s ON s.id = i.signalement_id
          WHERE s.status <> 'traite' AND s.ready_to_close_at IS NULL AND i.checked_commit IS DISTINCT FROM $1 ORDER BY 1`,
        [commit],
      );
      return rows.map((row) => row.issue_number);
    },

    async markIssuesChecked(issues, commit) {
      if (issues.length === 0) return;
      await database.query(`UPDATE signalement_issue SET checked_commit = $2 WHERE issue_number = ANY($1::int[])`, [issues, commit]);
    },

    async countsSince(since) {
      const [types, issues, ready] = await Promise.all([
        database.query<{ type: SignalementType; n: number }>(`SELECT type, count(*)::int AS n FROM signalement WHERE created_at >= $1 GROUP BY type`, [since]),
        database.query<{ issue_number: number; opened: boolean; n: number }>(
          `SELECT issue_number, bool_or(kind = 'opened') AS opened, count(*)::int AS n FROM signalement_issue WHERE linked_at >= $1 GROUP BY issue_number ORDER BY issue_number`,
          [since],
        ),
        database.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM signalement s JOIN signalement_draft d ON d.signalement_id = s.id WHERE s.ready_to_close_at IS NOT NULL AND s.status <> 'traite'`,
        ),
      ]);
      const newByType = Object.fromEntries(SIGNALEMENT_TYPES.map((type) => [type, types.rows.find((row) => row.type === type)?.n ?? 0])) as Record<SignalementType, number>;
      return {
        newByType,
        issues: issues.rows.map((row) => ({ number: row.issue_number, kind: row.opened ? ("opened" as const) : ("commented" as const), signalements: row.n })),
        readyWithDraft: ready.rows[0]!.n,
      };
    },

    async countToHandle() {
      const { rows } = await database.query<{ n: number }>(`SELECT count(*)::int AS n FROM signalement WHERE status = ANY($1::text[])`, [TO_HANDLE_STATUSES]);
      return rows[0]!.n;
    },
  };
}

/**
 * Every Signalement the Candidate sent, newest first: what their Data export holds, and what they can follow (#377);
 * with the numbers of its issues alone (#1141), never who linked them, its draft or « Prêt à clore ».
 */
export async function signalementsOf(database: Queryable, candidateId: string): Promise<OwnSignalement[]> {
  const { rows } = await database.query<Row & { issue_numbers: number[] }>(
    `SELECT ${COLUMNS}, (SELECT coalesce(array_agg(i.issue_number ORDER BY i.linked_at, i.issue_number), '{}') FROM signalement_issue i WHERE i.signalement_id = signalement.id) AS issue_numbers
       FROM signalement WHERE candidate_id = $1 ORDER BY created_at DESC, id`,
    [candidateId],
  );
  return rows.map((row) => ({ ...fromRow(row), issueNumbers: row.issue_numbers }));
}

/**
 * Deletes the Signalements marked `traite` RETENTION_MONTHS ago or more at `now`, each sent with the AI notice leaving
 * its trace as `treated` (#1173), and the traces left RETENTION_MONTHS ago or more; returns how many Signalements.
 * Safe to run again.
 */
export async function purgeSignalements(database: Queryable, now: Date): Promise<number> {
  const before = utcBefore("$1", "make_interval(months => $2)");
  const { rows } = await database.query<{ n: number }>(
    `WITH gone AS (DELETE FROM signalement WHERE status = 'traite' AND status_changed_at <= ${before} RETURNING id, ai_notice_shown),
       traced AS (INSERT INTO signalement_removed (id, removed_at, reason) SELECT id, $1, 'treated' FROM gone WHERE ai_notice_shown
         ON CONFLICT (id) DO UPDATE SET removed_at = EXCLUDED.removed_at, reason = EXCLUDED.reason),
       forgotten AS (DELETE FROM signalement_removed WHERE removed_at <= ${before})
     SELECT count(*)::int AS n FROM gone`,
    [now, RETENTION_MONTHS],
  );
  return rows[0]!.n;
}

const listed = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** Creates or upgrades the Signalement table. Needs the Candidate table. Safe to run repeatedly. */
export async function migrateSignalements(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS signalement (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      type text NOT NULL CHECK (type IN (${listed(SIGNALEMENT_TYPES)})),
      message text NOT NULL CHECK (char_length(message) BETWEEN ${MESSAGE_MIN_LENGTH} AND ${MESSAGE_MAX_LENGTH}),
      -- A Question's copy of the Candidate's question and the coach's reply; never a link to the Coach Conversation.
      attached_question text,
      attached_coach_reply text,
      -- The page's path, without query string or #…
      path text,
      version text NOT NULL,
      -- Parsed to « Chrome 141, Mac »; never the raw user agent.
      browser text,
      interface_language text NOT NULL,
      text_size text NOT NULL,
      status text NOT NULL DEFAULT 'nouveau' CHECK (status IN (${listed(SIGNALEMENT_STATUSES)})),
      status_changed_at timestamptz,
      reply text,
      reply_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (reply IS NULL OR char_length(reply) <= ${REPLY_MAX_LENGTH}),
      CHECK ((type = 'question') = (attached_question IS NOT NULL AND attached_coach_reply IS NOT NULL))
    );
    -- When the team's reply was first saved: reply_updated_at is when it last was (#377).
    ALTER TABLE signalement ADD COLUMN IF NOT EXISTS replied_at timestamptz;
    -- When the Candidate last closed its notification, or opened « Mes signalements » (#377).
    ALTER TABLE signalement ADD COLUMN IF NOT EXISTS notification_closed_at timestamptz;
    -- Whether the form said « Un outil d'IA peut lire votre message… » (#1139): false for every one sent before it.
    ALTER TABLE signalement ADD COLUMN IF NOT EXISTS ai_notice_shown boolean NOT NULL DEFAULT false;
    -- The Agent Key that set its status (key:triage-beta, #1139); null when the team did. Never in the Data export.
    ALTER TABLE signalement ADD COLUMN IF NOT EXISTS status_changed_by text;
    CREATE INDEX IF NOT EXISTS signalement_candidate_idx ON signalement (candidate_id, created_at);
    CREATE INDEX IF NOT EXISTS signalement_handled_idx ON signalement (status_changed_at) WHERE status = 'traite';
    -- « Prêt à clore » (#1141): when a deployed commit closed one of its issues in its environment. The team's alone.
    ALTER TABLE signalement ADD COLUMN IF NOT EXISTS ready_to_close_at timestamptz;
    -- The issues Jobbbox published or commented for it (#1141, ADR-0118): their number, never their text. Deleting the
    -- Signalement removes the link and leaves the issue, which holds nothing of the Candidate.
    CREATE TABLE IF NOT EXISTS signalement_issue (
      signalement_id uuid NOT NULL REFERENCES signalement (id) ON DELETE CASCADE,
      issue_number integer NOT NULL CHECK (issue_number > 0),
      kind text NOT NULL CHECK (kind IN (${listed(ISSUE_LINK_KINDS)})),
      linked_at timestamptz NOT NULL,
      -- The Agent Key that proposed it (key:triage-beta). Never in the Data export.
      linked_by text NOT NULL,
      -- The deployed commit it was last checked against for « Prêt à clore ».
      checked_commit text,
      PRIMARY KEY (signalement_id, issue_number)
    );
    CREATE INDEX IF NOT EXISTS signalement_issue_number_idx ON signalement_issue (issue_number);
    -- The draft reply an Agent Key proposed (#1141), in French and in English, until Support sends or deletes it.
    CREATE TABLE IF NOT EXISTS signalement_draft (
      signalement_id uuid PRIMARY KEY REFERENCES signalement (id) ON DELETE CASCADE,
      fr text NOT NULL CHECK (char_length(fr) BETWEEN 1 AND ${REPLY_MAX_LENGTH}),
      en text NOT NULL CHECK (char_length(en) BETWEEN 1 AND ${REPLY_MAX_LENGTH}),
      proposed_by text,
      proposed_at timestamptz NOT NULL,
      edited_at timestamptz
    );
    -- The trace of a Signalement sent with the AI notice once it is gone (#1173): its id, when and why, nothing of the
    -- Candidate, so Signalement triage is told why it is not found. Kept RETENTION_MONTHS (purgeSignalements). Deleted
    -- by the Candidate, alone or with their account, it is 'deleted'; purgeSignalements writes 'treated' first.
    CREATE TABLE IF NOT EXISTS signalement_removed (
      id uuid PRIMARY KEY,
      removed_at timestamptz NOT NULL,
      reason text NOT NULL CHECK (reason IN (${listed(REMOVAL_REASONS)}))
    );
    CREATE INDEX IF NOT EXISTS signalement_removed_at_idx ON signalement_removed (removed_at);
    CREATE OR REPLACE FUNCTION signalement_removal_trace() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO signalement_removed (id, removed_at, reason) VALUES (OLD.id, now(), 'deleted') ON CONFLICT (id) DO NOTHING;
      RETURN OLD;
    END $$;
    DROP TRIGGER IF EXISTS signalement_removal_trace ON signalement;
    CREATE TRIGGER signalement_removal_trace AFTER DELETE ON signalement FOR EACH ROW WHEN (OLD.ai_notice_shown) EXECUTE FUNCTION signalement_removal_trace();
  `);
}
