/**
 * Signalements (#278, #374): what a signed-in Candidate sends the Jobbbox team from the app (a Bug, an Idée, or a
 * Question after help that did not satisfy them), read by people only, never sent to an AI, so never redacted (#283).
 *
 * One deep module in front of Postgres. `createSignalements(database, { version })` answers:
 *  - `send` one: checks its type and message, keeps its context (the page's path without query or `#…`, the
 *    Jobbbox version, the browser parsed to « Chrome 141, Mac », the Interface Language and the Text Size; never the
 *    raw user agent), and refuses an (SENDING_LIMIT + 1)th within a rolling SENDING_WINDOW_HOURS, counted in the
 *    database. A Question carries a copy of the Candidate's question and the coach's reply, never a link to the Coach
 *    Conversation, so it stays readable once that conversation is deleted;
 * and `migrateSignalements(database)` and `purgeSignalements(database, now)` (the worker, nightly: RETENTION_MONTHS
 * after it was marked `traite`).
 *
 * Tied to the Candidate: deleted with their account (ON DELETE CASCADE, ADR-0010) and in their Data export. It never
 * names which Administrator changed its status or replied; the Back Office Audit does.
 *
 * The values (types, statuses, limits) are in ./values, the only list of each.
 */
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@jobhub/shared/i18n";
import { resolveTextSize, type TextSizeSetting } from "@jobhub/shared/design";
import type { Pool } from "pg";
import { inTransaction } from "../database/pool";
import type { FieldError } from "../validation";
import { browserOf, pagePath } from "./context";
import {
  ATTACHED_MAX_LENGTH,
  isSignalementType,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MIN_LENGTH,
  SENDING_LIMIT,
  SENDING_WINDOW_HOURS,
  SIGNALEMENT_STATUSES,
  SIGNALEMENT_TYPES,
  type SignalementStatus,
  type SignalementType,
} from "./values";

export * from "./values";

/** Where a Signalement was sent from, as it is kept. */
export interface SignalementContext {
  /** The page's path, without query string or `#…`; null when it was not known. */
  path: string | null;
  /** The Jobbbox version that served it. */
  version: string;
  /** « Chrome 141, Mac »; null when the browser said nothing. */
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
  status: SignalementStatus;
  /** When its status last changed; null while `nouveau` from the start. */
  statusChangedAt: Date | null;
  /** The team's reply, signed « L'équipe Jobbbox », never with an Administrator's name; null while there is none. */
  reply: string | null;
  replyUpdatedAt: Date | null;
  createdAt: Date;
}

/** What the request says of where it comes from: the server's knowledge, never the sent body's. */
export interface SendingContext {
  /** The request's User-Agent header, read to name the browser and then dropped. */
  userAgent: string | null;
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
  status: SignalementStatus;
  status_changed_at: Date | null;
  reply: string | null;
  reply_updated_at: Date | null;
  created_at: Date;
}

const COLUMNS = `id::text, type, message, attached_question, attached_coach_reply, path, version, browser, interface_language, text_size,
  status, status_changed_at, reply, reply_updated_at, created_at`;

const fromRow = (row: Row): Signalement => ({
  id: row.id,
  type: row.type,
  message: row.message,
  attachedQuestion: row.attached_question,
  attachedCoachReply: row.attached_coach_reply,
  context: { path: row.path, version: row.version, browser: row.browser, interfaceLanguage: row.interface_language, textSize: row.text_size },
  status: row.status,
  statusChangedAt: row.status_changed_at,
  reply: row.reply,
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
  };
}

export function createSignalements(database: Pool, deps: SignalementsDeps): Signalements {
  const now = deps.now ?? (() => new Date());

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
          `INSERT INTO signalement (candidate_id, type, message, attached_question, attached_coach_reply, path, version, browser, interface_language, text_size, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLUMNS}`,
          [
            candidateId,
            signalement.type,
            signalement.message,
            signalement.attachedQuestion,
            signalement.attachedCoachReply,
            signalement.path,
            deps.version,
            browserOf(context.userAgent),
            isSupportedLocale(context.interfaceLanguage) ? context.interfaceLanguage : DEFAULT_LOCALE,
            signalement.textSize,
            at,
          ],
        );
        return { ok: true, signalement: fromRow(rows[0]!) } as const;
      });
    },
  };
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
      CHECK ((type = 'question') = (attached_question IS NOT NULL AND attached_coach_reply IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS signalement_candidate_idx ON signalement (candidate_id, created_at);
  `);
}
