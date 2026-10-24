/**
 * Unanswered Questions (#344, ADR-0035): the Candidates' questions to the AI Coach that the help missed, for Help
 * editors to turn into Help Articles or synonyms. An AI answer never becomes help by itself.
 *
 * One deep module in front of Postgres. `createUnansweredQuestions(database, { identityOf })` answers:
 *  - `notice` an AI Coach reply: its question is recorded only when no Help Article matched it (the search the
 *    Coach Panel's box runs, see ../coach-help), the AI Coach replied (not blocked, not distress, not unavailable)
 *    and marked it as asking how to use Jobbbox. The same question again (same words as the search reads them,
 *    same page, same Interface Language) raises its `count`;
 *  - `open` the ones not marked yet, most asked first, by page (route pattern) and by language;
 *  - `mark` one « Article écrit » (written) or « Écarter » (dismissed), on the Back Office's transaction.
 * and `purgeUnansweredQuestions(database, now)` (the worker, daily) and `migrateUnansweredQuestions(database)`.
 *
 * Never linked to the Candidate: no Candidate id, no Coach Conversation id, no account, so it is in no Data export
 * and survives no one's deletion. The question and the AI Coach's answer are kept redacted as AI calls are (the
 * Candidate's known identity, and every email address and phone number by its shape), and the page only as its
 * route pattern (`/candidatures/[id]/documents`), never an id. Kept RETENTION_MONTHS after it was last asked, and
 * MARKED_RETENTION_DAYS after it was marked written or dismissed.
 */
import { redactIdentity, type CandidateIdentity } from "@jobhub/ai";
import { questionKey } from "@jobhub/help";
import type { Pool } from "pg";
import type { CoachReplyOutcome } from "../coach";
import { helpLocale, helpSuggestions } from "../coach-help";
import type { Queryable } from "../database/pool";

export const UNANSWERED_QUESTION_STATUSES = ["open", "written", "dismissed"] as const;
export type UnansweredQuestionStatus = (typeof UNANSWERED_QUESTION_STATUSES)[number];

/** What a Help editor marks an open one: « Article écrit » or « Écarter ». */
export type UnansweredQuestionMark = Exclude<UnansweredQuestionStatus, "open">;
export const isUnansweredQuestionMark = (value: unknown): value is UnansweredQuestionMark => value === "written" || value === "dismissed";

export const UNANSWERED_QUESTION_LANGUAGES = ["fr", "en"] as const;
export type UnansweredQuestionLanguage = (typeof UNANSWERED_QUESTION_LANGUAGES)[number];

export interface UnansweredQuestion {
  id: string;
  /** The Candidate's question, redacted. The first one asked of its group. */
  question: string;
  /** The AI Coach's answer to it, redacted. */
  answer: string;
  /** The route pattern of the page it was asked from (`/candidatures/[id]`); null when it is not known. */
  route: string | null;
  /** The Candidate's Interface Language. */
  language: UnansweredQuestionLanguage;
  count: number;
  firstAskedAt: Date;
  lastAskedAt: Date;
  status: UnansweredQuestionStatus;
}

/** An AI Coach reply, as `notice` reads it: the Candidate's question, the reply and how it went, where and in which language. */
export interface NoticedReply {
  question: string;
  reply: { text: string; outcome: CoachReplyOutcome; aboutJobbbox?: boolean };
  /** The address of the page the question was asked from; taken down to its route pattern. */
  route?: string | null;
  language: UnansweredQuestionLanguage;
}

export interface UnansweredQuestions {
  /** Records `asked` when the help missed a question about using Jobbbox (see above); whether it did. Never throws for the reply's content. */
  notice(candidateId: string, asked: NoticedReply): Promise<boolean>;
  /** The open ones, most asked first (then the latest asked), of one route pattern, one language, or both. */
  open(filter?: { route?: string; language?: string }): Promise<UnansweredQuestion[]>;
  /** Marks an open one written or dismissed, on `within` (the Back Office's transaction); null when there is no open one with that id. */
  mark(id: string, status: UnansweredQuestionMark, within?: Queryable): Promise<{ before: UnansweredQuestion; after: UnansweredQuestion } | null>;
}

export interface UnansweredQuestionsDeps {
  /** What the AI layer knows of the Candidate, to redact as their AI calls are; a lookup that fails redacts by shape alone. */
  identityOf: (candidateId: string) => Promise<CandidateIdentity | null>;
  /** When a question is asked or marked. Default: the system clock. */
  now?: () => Date;
}

/** How long an Unanswered Question is kept after it was last asked. */
export const RETENTION_MONTHS = 12;
/** How long an Unanswered Question is kept once marked written or dismissed. */
export const MARKED_RETENTION_DAYS = 30;

/** Longest answer kept: enough for a Help editor to see what the AI Coach said. */
const MAX_ANSWER_LENGTH = 4_000;
const MAX_SEGMENTS = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The route pattern of a page's address: its path without query or fragment, each segment that is not a fixed word
 * of lower-case letters and hyphens (an id, whatever its shape) as `[id]`. Null for something that is not a path.
 */
export function routePattern(address: string | null | undefined): string | null {
  if (!address?.startsWith("/")) return null;
  const segments = address.split(/[?#]/)[0]!.split("/").filter(Boolean);
  if (segments.length > MAX_SEGMENTS) return null;
  return `/${segments.map((segment) => (/^[a-z]+(?:-[a-z]+)*$/.test(segment) ? segment : "[id]")).join("/")}`;
}

/** Whether the help missed `asked`: the AI Coach replied, said it asks how to use Jobbbox, and no Help Article matched it. */
function helpMissed({ question, reply, language }: NoticedReply): boolean {
  return reply.outcome === "replied" && reply.aboutJobbbox === true && helpSuggestions(question, helpLocale(language)).length === 0;
}

interface Row {
  id: string;
  question: string;
  answer: string;
  route: string | null;
  language: UnansweredQuestionLanguage;
  count: number;
  first_asked_at: Date;
  last_asked_at: Date;
  status: UnansweredQuestionStatus;
}

const COLUMNS = "id::text, question, answer, route, language, count, first_asked_at, last_asked_at, status";

const fromRow = (row: Row): UnansweredQuestion => ({
  id: row.id,
  question: row.question,
  answer: row.answer,
  route: row.route,
  language: row.language,
  count: row.count,
  firstAskedAt: row.first_asked_at,
  lastAskedAt: row.last_asked_at,
  status: row.status,
});

export function createUnansweredQuestions(database: Queryable, deps: UnansweredQuestionsDeps): UnansweredQuestions {
  const now = deps.now ?? (() => new Date());

  /** The question and the answer as AI calls send them: the Candidate's known identity and every email and phone taken out. */
  async function redacted(candidateId: string, texts: [string, string]): Promise<[string, string]> {
    const identity = await deps.identityOf(candidateId).catch((error: unknown) => {
      console.warn("[unanswered-questions] the Candidate's identity could not be read: redacting by shape alone", error instanceof Error ? error.name : error);
      return null;
    });
    const [question, answer] = redactIdentity(texts, identity).texts;
    return [question!, answer!];
  }

  return {
    async notice(candidateId, asked) {
      if (!helpMissed(asked)) return false;
      const key = questionKey(asked.question);
      if (!key) return false;
      const [question, answer] = await redacted(candidateId, [asked.question.trim(), asked.reply.text.trim().slice(0, MAX_ANSWER_LENGTH)]);
      const at = now();
      await database.query(
        `INSERT INTO unanswered_question (question, answer, question_key, route, language, count, first_asked_at, last_asked_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $6)
         ON CONFLICT (language, question_key, coalesce(route, '')) WHERE status = 'open'
         DO UPDATE SET count = unanswered_question.count + 1, last_asked_at = greatest(unanswered_question.last_asked_at, EXCLUDED.last_asked_at)`,
        [question, answer, key, routePattern(asked.route), asked.language, at],
      );
      return true;
    },

    async open({ route, language } = {}) {
      const { rows } = await database.query<Row>(
        `SELECT ${COLUMNS} FROM unanswered_question
          WHERE status = 'open' AND ($1::text IS NULL OR route = $1) AND ($2::text IS NULL OR language = $2)
          ORDER BY count DESC, last_asked_at DESC, route NULLS FIRST, language, question`,
        [route ?? null, language ?? null],
      );
      return rows.map(fromRow);
    },

    async mark(id, status, within = database) {
      if (!UUID.test(id) || !isUnansweredQuestionMark(status)) return null;
      const { rows } = await within.query<Row>(
        `UPDATE unanswered_question SET status = $2, status_changed_at = $3 WHERE id = $1 AND status = 'open' RETURNING ${COLUMNS}`,
        [id, status, now()],
      );
      const after = rows[0];
      return after ? { before: { ...fromRow(after), status: "open" }, after: fromRow(after) } : null;
    },
  };
}

/**
 * Deletes the Unanswered Questions last asked RETENTION_MONTHS ago or more at `now`, and those marked written or
 * dismissed MARKED_RETENTION_DAYS ago or more; returns how many. Safe to run again.
 */
export async function purgeUnansweredQuestions(database: Queryable, now: Date): Promise<number> {
  const { rowCount } = await database.query(
    `DELETE FROM unanswered_question
      WHERE last_asked_at <= $1::timestamptz - make_interval(months => $2)
         OR (status <> 'open' AND status_changed_at <= $1::timestamptz - make_interval(days => $3))`,
    [now, RETENTION_MONTHS, MARKED_RETENTION_DAYS],
  );
  return rowCount ?? 0;
}

/** Creates or upgrades the Unanswered Questions table. Needs no other table: it references none. Safe to run repeatedly. */
export async function migrateUnansweredQuestions(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS unanswered_question (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      question text NOT NULL,
      answer text NOT NULL,
      -- The question's words as the help's search reads them, to group the same question asked again.
      question_key text NOT NULL,
      route text,
      language text NOT NULL CHECK (language IN ('fr', 'en')),
      count integer NOT NULL DEFAULT 1,
      first_asked_at timestamptz NOT NULL,
      last_asked_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'written', 'dismissed')),
      status_changed_at timestamptz
    );
    -- One open row per question, page and language; a question asked again once marked opens a new one.
    CREATE UNIQUE INDEX IF NOT EXISTS unanswered_question_open_idx ON unanswered_question (language, question_key, coalesce(route, '')) WHERE status = 'open';
    CREATE INDEX IF NOT EXISTS unanswered_question_last_asked_idx ON unanswered_question (last_asked_at);
  `);
}
