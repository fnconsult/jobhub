/**
 * Coach Conversations: the Candidate's conversations with the AI Coach in the
 * Coach Panel, saved so they survive a reload and can be reopened later.
 *
 * One deep module in front of Postgres. Callers get
 * `createCoachConversations(database, { coach, profiles })`:
 *  - `send` the Candidate's next message, untrusted input from the browser
 *    `{ conversationId?, message, focus? }`: the AI Coach answers the saved
 *    conversation (a new one without `conversationId`, attached to the Profile
 *    in view when it starts) and both messages are saved together. Nothing is
 *    saved when the AI Coach cannot answer, so the Candidate can send again;
 *  - `list` the Candidate's conversations, most recently active first;
 *  - `open` one with its messages; `rename` it; `delete` it.
 * Every read and change is scoped to the Candidate: another Candidate's
 * conversation is "not found". Never throws for bad input: an error code comes back.
 * Kept RETENTION_MONTHS after their last message (`purgeStaleCoachConversations`,
 * run daily by the worker) and deleted with the account (ADR-0010). Human
 * Coaches never read them: Coach Access covers Profiles and Applications only.
 */
import type { Pool } from "pg";
import * as z from "zod";
import type { Coach, CoachFocus } from "../coach";
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

export interface CoachConversations {
  send(candidateId: string, input: unknown): Promise<SendResult>;
  open(candidateId: string, conversationId: string): Promise<CoachConversation | null>;
}

export interface CoachConversationsDeps {
  coach: Pick<Coach, "reply">;
  profiles: Pick<Profiles, "get">;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest conversation title; a new conversation is named after the start of its first message. */
export const MAX_TITLE_LENGTH = 80;

const sendSchema = z.object({
  conversationId: z.string().regex(UUID).optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  focus: z.object({ kind: z.enum(["profile", "application"]), id: z.string().max(100) }).optional(),
});

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

      const answer = await deps.coach.reply(candidateId, { messages: [...history, { from: "candidate", text: message }], ...(focus ? { focus } : {}) });
      if (!answer.ok) return answer;

      const client = await database.connect();
      try {
        await client.query("BEGIN");
        let id = existing?.id;
        if (!id) {
          const profileId = await profileInView(candidateId, focus);
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO coach_conversation (candidate_id, profile_id, title) VALUES ($1, $2, $3) RETURNING id`,
            [candidateId, profileId, titleFrom(message)],
          );
          id = rows[0]!.id;
        }
        await client.query(
          `INSERT INTO coach_message (conversation_id, author, text) VALUES ($1, 'candidate', $2), ($1, 'coach', $3)`,
          [id, message, answer.reply],
        );
        await client.query(`UPDATE coach_conversation SET last_message_at = now() WHERE id = $1`, [id]);
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

    async open(candidateId, conversationId) {
      const conversation = await find(candidateId, conversationId);
      if (!conversation) return null;
      return { ...conversation, messages: await lastMessages(conversation.id, null) };
    },
  };

  /** The Profile in view, if it is the Candidate's: the one a new conversation is attached to. */
  async function profileInView(candidateId: string, focus: CoachFocus | undefined): Promise<string | null> {
    if (focus?.kind !== "profile") return null;
    return (await deps.profiles.get(candidateId, focus.id))?.id ?? null;
  }
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
  `);
}
