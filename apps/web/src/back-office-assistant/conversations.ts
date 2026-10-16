/**
 * The Back Office Assistant's conversations: an Administrator's conversations with
 * the assistant in the Back Office, saved so they survive a reload and can be reopened.
 *
 * One deep module in front of Postgres. Callers get `createAssistantConversations(database, { assistant })`:
 *  - `send` the Administrator's next message, untrusted input from the browser
 *    `{ conversationId?, message }`: the assistant answers the saved conversation (a new
 *    one without `conversationId`) and both messages are saved together. Nothing is saved
 *    when the assistant cannot answer, so the Administrator can send again;
 *  - `list` their conversations, most recently active first; `open` one with its
 *    messages; `rename` it; `delete` it.
 * Every read and change is scoped to the Administrator: another's conversation is
 * "not found". Never throws for bad input: an error code comes back.
 *
 * Kept apart from Candidates' Coach Conversations, in tables of their own, and counted
 * against no Plan Quota. They are the Administrator's personal data: in their data
 * export, deleted with their account (ADR-0010), and purged RETENTION_MONTHS after
 * their last message (`purgeStaleAssistantConversations`, run daily by the worker).
 */
import type { Pool } from "pg";
import * as z from "zod";
import { MAX_MESSAGE_LENGTH, MAX_MESSAGES, type AssistantMessage } from "./conversation";
import type { AskingAdministrator, BackOfficeAssistant } from "./index";

export interface AssistantConversationSummary {
  id: string;
  title: string;
  lastMessageAt: Date;
}

export interface AssistantConversation extends AssistantConversationSummary {
  messages: AssistantMessage[];
}

export type AssistantSendResult =
  | { ok: true; conversation: AssistantConversationSummary; reply: string }
  | { ok: false; error: "invalid" | "not_found" | "unavailable" };

export type AssistantRenameResult = { ok: true; conversation: AssistantConversationSummary } | { ok: false; error: "invalid" | "not_found" };

export interface AssistantConversations {
  send(administrator: AskingAdministrator, input: unknown): Promise<AssistantSendResult>;
  /** The Administrator's conversations, most recently active first. */
  list(administratorId: string): Promise<AssistantConversationSummary[]>;
  open(administratorId: string, conversationId: string): Promise<AssistantConversation | null>;
  /** `title` is untrusted: trimmed, 1 to MAX_TITLE_LENGTH characters. */
  rename(administratorId: string, conversationId: string, title: unknown): Promise<AssistantRenameResult>;
  /** Deletes the conversation and its messages; false when there is none of the Administrator's to delete. */
  delete(administratorId: string, conversationId: string): Promise<boolean>;
}

export interface AssistantConversationsDeps {
  assistant: Pick<BackOfficeAssistant, "reply">;
  /** When messages are sent. Default: the system clock. */
  now?: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest conversation title; a new conversation is named after the start of its first message. */
export const MAX_TITLE_LENGTH = 80;

/** How long a conversation is kept after its last message. */
export const RETENTION_MONTHS = 12;

const titleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH);

const sendSchema = z.object({
  conversationId: z.string().regex(UUID).optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

const SUMMARY = `SELECT id, title, last_message_at AS "lastMessageAt" FROM back_office_assistant_conversation`;

function titleFrom(message: string): string {
  const words = message.replace(/\s+/g, " ").trim();
  return words.length <= MAX_TITLE_LENGTH ? words : `${words.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function createAssistantConversations(database: Pool, deps: AssistantConversationsDeps): AssistantConversations {
  const now = deps.now ?? (() => new Date());

  async function find(administratorId: string, conversationId: string): Promise<AssistantConversationSummary | null> {
    if (!UUID.test(conversationId)) return null;
    const { rows } = await database.query<AssistantConversationSummary>(`${SUMMARY} WHERE id = $1 AND candidate_id = $2`, [conversationId, administratorId]);
    return rows[0] ?? null;
  }

  /** The last `limit` messages of a conversation (all with null), oldest first. */
  async function lastMessages(conversationId: string, limit: number | null): Promise<AssistantMessage[]> {
    const { rows } = await database.query<AssistantMessage>(
      `SELECT author AS "from", text FROM (
         SELECT author, text, seq FROM back_office_assistant_message WHERE conversation_id = $1 ORDER BY seq DESC LIMIT $2
       ) recent ORDER BY seq`,
      [conversationId, limit],
    );
    return rows;
  }

  return {
    async send(administrator, input) {
      const parsed = sendSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const { conversationId, message } = parsed.data;

      const existing = conversationId ? await find(administrator.id, conversationId) : null;
      if (conversationId && !existing) return { ok: false, error: "not_found" };
      const history = existing ? await lastMessages(existing.id, MAX_MESSAGES) : [];

      const answer = await deps.assistant.reply(administrator, { messages: [...history, { from: "administrator", text: message }] });
      if (!answer.ok) return answer;

      const sentAt = now();
      const { cost } = answer;
      let id = existing?.id;
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        if (!id) {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO back_office_assistant_conversation (candidate_id, title, created_at, last_message_at) VALUES ($1, $2, $3, $3) RETURNING id`,
            [administrator.id, titleFrom(message), sentAt],
          );
          id = rows[0]!.id;
        }
        await client.query(`INSERT INTO back_office_assistant_message (conversation_id, author, text, created_at) VALUES ($1, 'administrator', $2, $3)`, [
          id,
          message,
          sentAt,
        ]);
        await client.query(
          `INSERT INTO back_office_assistant_message (conversation_id, author, text, created_at, provider, model, cost_eur) VALUES ($1, 'assistant', $2, $3, $4, $5, $6)`,
          [id, answer.reply, sentAt, cost.provider, cost.model, cost.eur],
        );
        await client.query(`UPDATE back_office_assistant_conversation SET last_message_at = $2 WHERE id = $1`, [id, sentAt]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      const conversation = id ? await find(administrator.id, id) : null;
      if (!conversation) return { ok: false, error: "not_found" }; // deleted meanwhile
      return { ok: true, conversation, reply: answer.reply };
    },

    async list(administratorId) {
      const { rows } = await database.query<AssistantConversationSummary>(`${SUMMARY} WHERE candidate_id = $1 ORDER BY last_message_at DESC, created_at DESC`, [
        administratorId,
      ]);
      return rows;
    },

    async open(administratorId, conversationId) {
      const conversation = await find(administratorId, conversationId);
      if (!conversation) return null;
      return { ...conversation, messages: await lastMessages(conversation.id, null) };
    },

    async rename(administratorId, conversationId, title) {
      const parsed = titleSchema.safeParse(title);
      if (!parsed.success) return { ok: false, error: "invalid" };
      if (!UUID.test(conversationId)) return { ok: false, error: "not_found" };
      const { rowCount } = await database.query(`UPDATE back_office_assistant_conversation SET title = $3 WHERE id = $1 AND candidate_id = $2`, [
        conversationId,
        administratorId,
        parsed.data,
      ]);
      const conversation = rowCount ? await find(administratorId, conversationId) : null;
      return conversation ? { ok: true, conversation } : { ok: false, error: "not_found" };
    },

    async delete(administratorId, conversationId) {
      if (!UUID.test(conversationId)) return false;
      const { rowCount } = await database.query(`DELETE FROM back_office_assistant_conversation WHERE id = $1 AND candidate_id = $2`, [
        conversationId,
        administratorId,
      ]);
      return rowCount === 1;
    },
  };
}

/**
 * Deletes the conversations whose last message is RETENTION_MONTHS old or more at
 * `now`, with their messages; returns how many. Safe to run again.
 */
export async function purgeStaleAssistantConversations(database: Pick<Pool, "query">, now: Date): Promise<number> {
  const { rowCount } = await database.query(
    `DELETE FROM back_office_assistant_conversation WHERE last_message_at <= $1::timestamptz - make_interval(months => $2)`,
    [now, RETENTION_MONTHS],
  );
  return rowCount ?? 0;
}

/** Creates the Back Office Assistant's tables. Run after the Candidate accounts' migration. Safe to run repeatedly. */
export async function migrateAssistantConversations(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS back_office_assistant_conversation (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      title text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_message_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS back_office_assistant_conversation_candidate_idx ON back_office_assistant_conversation (candidate_id, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS back_office_assistant_conversation_last_message_idx ON back_office_assistant_conversation (last_message_at);
    CREATE TABLE IF NOT EXISTS back_office_assistant_message (
      seq bigserial PRIMARY KEY,
      conversation_id uuid NOT NULL REFERENCES back_office_assistant_conversation (id) ON DELETE CASCADE,
      author text NOT NULL CHECK (author IN ('administrator', 'assistant')),
      text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      -- Who answered and what it cost Jobbbox (an estimate at list prices); null on the Administrator's messages.
      provider text,
      model text,
      cost_eur double precision
    );
    CREATE INDEX IF NOT EXISTS back_office_assistant_message_conversation_idx ON back_office_assistant_message (conversation_id, seq);
  `);
}
