/**
 * Coach Conversations: the Candidate's conversations with the AI Coach in the
 * Coach Panel, saved so they survive a reload and can be reopened later.
 *
 * One deep module in front of Postgres. Callers get
 * `createCoachConversations(database, { coach, profiles })`:
 *  - `send` the Candidate's next message, untrusted input from the browser
 *    `{ conversationId?, message, focus? }`: the AI Coach answers the saved
 *    conversation (a new one without `conversationId`, attached to the Profile
 *    in view when it starts, or to the Profile the page in view shows: `focus.profileId`) and both messages are saved together. Nothing is
 *    saved when the AI Coach cannot answer, so the Candidate can send again;
 *  - `list` the Candidate's conversations, most recently active first;
 *  - `open` one with its messages; `rename` it; `delete` it.
 * Every read and change is scoped to the Candidate: another Candidate's
 * conversation is "not found". Never throws for bad input: an error code comes back.
 * Each AI Coach message is saved with what it cost (provider, model, tokens in,
 * out and cached, estimated €); `coachCostPerDay` gives the Administrator the
 * median and p90 cost per day, to check the €0.03 per message target (#127).
 * Kept RETENTION_MONTHS after their last message (`purgeStaleCoachConversations`,
 * run daily by the worker) and deleted with the account (ADR-0010). Human
 * Coaches never read them: Coach Access covers Profiles and Applications only.
 */
import type { Pool } from "pg";
import * as z from "zod";
import { COACH_FOCUS_KINDS, type Coach, type CoachMessageCost } from "../coach";
import { MAX_MESSAGE_LENGTH, MAX_MESSAGES, type CoachMessage } from "../coach/conversation";
import type { Profiles } from "../profiles";

export interface CoachConversationSummary {
  id: string;
  title: string;
  /** The Profile in view when the conversation started, if any. */
  profile: { id: string; name: string } | null;
  lastMessageAt: Date;
}

export interface CoachConversation extends CoachConversationSummary {
  messages: CoachMessage[];
}

export type SendResult =
  | { ok: true; conversation: CoachConversationSummary; reply: string }
  | { ok: false; error: "invalid" | "not_found" | "unavailable" };

export type RenameResult = { ok: true; conversation: CoachConversationSummary } | { ok: false; error: "invalid" | "not_found" };

export interface CoachConversations {
  send(candidateId: string, input: unknown): Promise<SendResult>;
  /** The Candidate's conversations, most recently active first. */
  list(candidateId: string): Promise<CoachConversationSummary[]>;
  open(candidateId: string, conversationId: string): Promise<CoachConversation | null>;
  /** `title` is untrusted: trimmed, 1 to MAX_TITLE_LENGTH characters. */
  rename(candidateId: string, conversationId: string, title: unknown): Promise<RenameResult>;
  /** Deletes the conversation and its messages; false when there is none of the Candidate's to delete. */
  delete(candidateId: string, conversationId: string): Promise<boolean>;
}

export interface CoachConversationsDeps {
  coach: Pick<Coach, "reply">;
  profiles: Pick<Profiles, "get">;
  /** When messages are sent. Default: the system clock. */
  now?: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest conversation title; a new conversation is named after the start of its first message. */
export const MAX_TITLE_LENGTH = 80;

const titleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH);

const sendSchema = z.object({
  conversationId: z.string().regex(UUID).optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  /** What is in view; `profileId`: the Profile a Job Search, Job Digest or Application page shows, to attach a new conversation to. */
  focus: z.object({ kind: z.enum(COACH_FOCUS_KINDS), id: z.string().max(100), profileId: z.string().max(100).optional() }).optional(),
});

type FocusInput = z.infer<typeof sendSchema>["focus"];

interface ConversationRow {
  id: string;
  title: string;
  profile_id: string | null;
  profile_name: string | null;
  last_message_at: Date;
}

const SUMMARY = `SELECT c.id, c.title, c.profile_id, p.name AS profile_name, c.last_message_at
                   FROM coach_conversation c LEFT JOIN profile p ON p.id = c.profile_id`;

function summaryFrom(row: ConversationRow): CoachConversationSummary {
  return {
    id: row.id,
    title: row.title,
    profile: row.profile_id && row.profile_name !== null ? { id: row.profile_id, name: row.profile_name } : null,
    lastMessageAt: row.last_message_at,
  };
}

function titleFrom(message: string): string {
  const words = message.replace(/\s+/g, " ").trim();
  return words.length <= MAX_TITLE_LENGTH ? words : `${words.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function createCoachConversations(database: Pool, deps: CoachConversationsDeps): CoachConversations {
  const now = deps.now ?? (() => new Date());
  async function find(candidateId: string, conversationId: string): Promise<CoachConversationSummary | null> {
    if (!UUID.test(conversationId)) return null;
    const { rows } = await database.query<ConversationRow>(`${SUMMARY} WHERE c.id = $1 AND c.candidate_id = $2`, [conversationId, candidateId]);
    return rows[0] ? summaryFrom(rows[0]) : null;
  }

  /** The last `limit` messages of a conversation, oldest first. */
  async function lastMessages(conversationId: string, limit: number | null): Promise<CoachMessage[]> {
    const { rows } = await database.query<CoachMessage>(
      `SELECT author AS "from", text FROM (
         SELECT author, text, seq FROM coach_message WHERE conversation_id = $1 ORDER BY seq DESC LIMIT $2
       ) recent ORDER BY seq`,
      [conversationId, limit],
    );
    return rows;
  }

  return {
    async send(candidateId, input) {
      const parsed = sendSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const { conversationId, message, focus } = parsed.data;

      const existing = conversationId ? await find(candidateId, conversationId) : null;
      if (conversationId && !existing) return { ok: false, error: "not_found" };
      const history = existing ? await lastMessages(existing.id, MAX_MESSAGES) : [];

      const answer = await deps.coach.reply(candidateId, {
        messages: [...history, { from: "candidate", text: message }],
        ...(focus ? { focus: { kind: focus.kind, id: focus.id } } : {}),
      });
      if (!answer.ok) return answer;

      const sentAt = now();
      const { cost } = answer;
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        let id = existing?.id;
        if (!id) {
          const profileId = await profileInView(candidateId, focus);
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO coach_conversation (candidate_id, profile_id, title, created_at, last_message_at) VALUES ($1, $2, $3, $4, $4) RETURNING id`,
            [candidateId, profileId, titleFrom(message), sentAt],
          );
          id = rows[0]!.id;
        }
        await client.query(`INSERT INTO coach_message (conversation_id, author, text, created_at) VALUES ($1, 'candidate', $2, $3)`, [id, message, sentAt]);
        await client.query(
          `INSERT INTO coach_message (conversation_id, author, text, created_at, provider, model, input_tokens, output_tokens, cached_input_tokens, cost_eur)
           VALUES ($1, 'coach', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, answer.reply, sentAt, cost.provider, cost.model, cost.inputTokens, cost.outputTokens, cost.cachedInputTokens, cost.eur],
        );
        await client.query(`UPDATE coach_conversation SET last_message_at = $2 WHERE id = $1`, [id, sentAt]);
        await client.query("COMMIT");
        const conversation = await find(candidateId, id);
        if (!conversation) return { ok: false, error: "not_found" }; // deleted meanwhile
        return { ok: true, conversation, reply: answer.reply };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async list(candidateId) {
      const { rows } = await database.query<ConversationRow>(`${SUMMARY} WHERE c.candidate_id = $1 ORDER BY c.last_message_at DESC, c.created_at DESC`, [
        candidateId,
      ]);
      return rows.map(summaryFrom);
    },

    async open(candidateId, conversationId) {
      const conversation = await find(candidateId, conversationId);
      if (!conversation) return null;
      return { ...conversation, messages: await lastMessages(conversation.id, null) };
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

    async delete(candidateId, conversationId) {
      if (!UUID.test(conversationId)) return false;
      const { rowCount } = await database.query(`DELETE FROM coach_conversation WHERE id = $1 AND candidate_id = $2`, [conversationId, candidateId]);
      return rowCount === 1;
    },
  };

  /** The Profile in view, or the one the page in view shows, if it is the Candidate's: the one a new conversation is attached to. */
  async function profileInView(candidateId: string, focus: FocusInput): Promise<string | null> {
    const profileId = focus?.kind === "profile" ? focus.id : focus?.profileId;
    if (!profileId) return null;
    return (await deps.profiles.get(candidateId, profileId))?.id ?? null;
  }
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
              input_tokens, output_tokens, cached_input_tokens, cost_eur
         FROM coach_message WHERE author = 'coach' AND cost_eur IS NOT NULL AND created_at >= $1
     ), models AS (
       SELECT day, jsonb_agg(jsonb_build_object('provider', provider, 'model', model, 'messages', messages) ORDER BY messages DESC, provider, model) AS models
         FROM (SELECT day, provider, model, count(*)::int AS messages FROM costed GROUP BY day, provider, model) per_model
        GROUP BY day
     )
     SELECT c.day, count(*)::int AS messages,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY c.cost_eur) AS "medianEur",
            percentile_cont(0.9) WITHIN GROUP (ORDER BY c.cost_eur) AS "p90Eur",
            sum(c.input_tokens)::float8 AS "inputTokens", sum(c.output_tokens)::float8 AS "outputTokens",
            sum(c.cached_input_tokens)::float8 AS "cachedInputTokens", m.models
       FROM costed c JOIN models m USING (day)
      GROUP BY c.day, m.models
      ORDER BY c.day DESC`,
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

/** Creates or upgrades the Coach Conversation tables. Run after the Profile tables. Safe to run repeatedly. */
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
  `);
}
