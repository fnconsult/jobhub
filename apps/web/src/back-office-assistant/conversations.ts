/**
 * The Back Office Assistant's conversations: an Administrator's conversations with
 * the assistant in the Back Office, saved so they survive a reload and can be reopened.
 *
 * One deep module in front of Postgres. Callers get `createAssistantConversations(database, { assistant })`:
 *  - `send` the Administrator's next message, untrusted input from the browser
 *    `{ conversationId?, message, explained? }` (`explained`: the item an Explainable label asks about, #407, kept with
 *    the message and told again with every later one): the assistant answers the saved conversation (a new
 *    one without `conversationId`) and both messages are saved together. Nothing is saved
 *    when the assistant cannot answer, so the Administrator can send again;
 *  - `list` their conversations, most recently active first; `open` one with its
 *    messages; `rename` it; `delete` it.
 * Every read and change is scoped to the Administrator: another's conversation is
 * "not found". Never throws for bad input: an error code comes back.
 * Each reply is saved with its Provenance (#327), given back with it and when the conversation reopens; a reply saved before
 * gets a partial one, read on the fly from its provider and model.
 * Each reply is saved with the Back Office sections it was told about. Saved history
 * goes back to the assistant only within the roles the Administrator holds now: a
 * reply drawing on a section they can no longer read is replayed as OUT_OF_ROLE_REPLY,
 * so a role taken away never comes back through an old conversation.
 *
 * A question a Guardrail blocked and the Guardrail message answering it are saved marked as blocked, and
 * never replayed to the assistant; a reply replaced by its Guardrail message is marked too (#228).
 *
 * Kept apart from Candidates' Coach Conversations, in tables of their own, and counted
 * against no Plan Quota. They are the Administrator's personal data: in their data
 * export, deleted with their account (ADR-0010), and purged RETENTION_MONTHS after
 * their last message (`purgeStaleAssistantConversations`, run daily by the worker).
 */
import { activityOf } from "@jobhub/ai";
import { readProvenance, type Provenance } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import { MAX_MESSAGE_LENGTH, MAX_MESSAGES, type AssistantMessage, type ExplainedItem } from "./conversation";
import { explainedSchema } from "./explained";
import type { BackOfficeResource } from "../admin/access";
import type { GuardrailLanguage } from "../guardrails";
import type { AskingAdministrator, BackOfficeAssistant } from "./index";

export interface AssistantConversationSummary {
  id: string;
  title: string;
  lastMessageAt: Date;
}

export interface AssistantConversation extends AssistantConversationSummary {
  messages: AssistantMessage[];
}

/** `provenance`: what served the reply (#327); `at`: when it was saved, an ISO date. */
export type AssistantSendResult =
  | { ok: true; conversation: AssistantConversationSummary; reply: string; blocked: { message: boolean; reply: boolean }; provenance: Provenance; at: string }
  | { ok: false; error: "invalid" | "not_found" | "unavailable" };

export type AssistantRenameResult = { ok: true; conversation: AssistantConversationSummary } | { ok: false; error: "invalid" | "not_found" };

export interface AssistantConversations {
  /** `language`: the Administrator's, for a Guardrail message. */
  send(administrator: AskingAdministrator, input: unknown, options?: { language?: GuardrailLanguage }): Promise<AssistantSendResult>;
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

/** What the assistant is told in place of a saved reply drawing on a section the Administrator can no longer read. */
export const OUT_OF_ROLE_REPLY = "[Réponse retirée : elle portait sur des sections que vos rôles actuels ne couvrent plus.]";

/** Postgres error code for a foreign key violation (here: the conversation was deleted meanwhile). */
const FOREIGN_KEY_VIOLATION = "23503";

/** How long a conversation is kept after its last message. */
export const RETENTION_MONTHS = 12;

const titleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH);

const sendSchema = z.object({
  conversationId: z.string().regex(UUID).optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  explained: explainedSchema.optional(),
});

const SUMMARY = `SELECT id, title, last_message_at AS "lastMessageAt" FROM back_office_assistant_conversation`;

/** What a saved reply kept of what served it, as `SAVED_ASSISTANT_REPLY_COLUMNS` reads it (aliased `m`). */
export interface SavedAssistantReply {
  provenance: unknown;
  provider: string | null;
  model: string | null;
  at: Date;
}

export const SAVED_ASSISTANT_REPLY_COLUMNS = `m.provenance, m.provider, m.model, m.created_at AS at`;

/** A saved reply's Provenance: the one stored, else a partial one from its provider and model (no tokens were kept), else none. */
export function savedAssistantReplyProvenance(reply: SavedAssistantReply): Provenance | null {
  return readProvenance(reply.provenance, { activity: activityOf({ kind: "ai", task: "back_office_assistant" }), task: "back_office_assistant", ...reply });
}

type SavedMessage = Omit<AssistantMessage, "blocked" | "explained"> & { sections: BackOfficeResource[] | null; blocked: boolean; explained: ExplainedItem | null };

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

  /** The last `limit` messages of a conversation (all with null), oldest first; replies with the sections they drew on. */
  async function lastMessages(conversationId: string, limit: number | null): Promise<SavedMessage[]> {
    const { rows } = await database.query<Pick<AssistantMessage, "from" | "text"> & SavedAssistantReply & { sections: BackOfficeResource[] | null; blocked: boolean; explained: ExplainedItem | null }>(
      `SELECT m.author AS "from", m.text, m.sections, m.blocked, m.explained, ${SAVED_ASSISTANT_REPLY_COLUMNS} FROM (
         SELECT * FROM back_office_assistant_message WHERE conversation_id = $1 ORDER BY seq DESC LIMIT $2
       ) m ORDER BY m.seq`,
      [conversationId, limit],
    );
    return rows.map((row) => ({
      from: row.from,
      text: row.text,
      sections: row.sections,
      blocked: row.blocked,
      explained: row.explained,
      ...(row.from === "assistant" ? { provenance: savedAssistantReplyProvenance(row), at: row.at.toISOString() } : {}),
    }));
  }

  /** The saved history as the assistant may be told it now: replies outside `administrator`'s current roles withdrawn. */
  async function replayable(administrator: AskingAdministrator, conversationId: string): Promise<AssistantMessage[]> {
    const saved = await lastMessages(conversationId, MAX_MESSAGES);
    // A blocked question and the Guardrail message answering it are never replayed.
    const kept = saved.filter((message, index) => (message.from === "administrator" ? !message.blocked : !(saved[index - 1]?.from === "administrator" && saved[index - 1]!.blocked)));
    return kept.map(({ from, text, sections, explained }) => {
      if (from === "administrator") return { from, text, ...(explained ? { explained } : {}) };
      // A reply with no sections recorded counts as drawing on every one.
      const stillReadable = sections !== null && sections.every((section) => administrator.access.can(section, "read"));
      return { from, text: stillReadable ? text : OUT_OF_ROLE_REPLY };
    });
  }

  return {
    async send(administrator, input, options = {}) {
      const parsed = sendSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const { conversationId, message, explained } = parsed.data;

      const existing = conversationId ? await find(administrator.id, conversationId) : null;
      if (conversationId && !existing) return { ok: false, error: "not_found" };
      const history = existing ? await replayable(administrator, existing.id) : [];

      const answer = await deps.assistant.reply(administrator, { messages: [...history, { from: "administrator", text: message, ...(explained ? { explained } : {}) }] }, options.language ? { language: options.language } : undefined);
      if (!answer.ok) return answer;
      const blocked = { message: answer.outcome === "blocked_message", reply: answer.outcome === "blocked_message" || answer.outcome === "blocked_reply" };

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
        await client.query(
          `INSERT INTO back_office_assistant_message (conversation_id, author, text, created_at, blocked, explained) VALUES ($1, 'administrator', $2, $3, $4, $5)`,
          [id, message, sentAt, blocked.message, explained ? JSON.stringify(explained) : null],
        );
        await client.query(
          `INSERT INTO back_office_assistant_message (conversation_id, author, text, created_at, provider, model, cost_eur, sections, blocked, provenance)
           VALUES ($1, 'assistant', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, answer.reply, sentAt, cost.provider, cost.model, cost.eur, answer.sections, blocked.reply, JSON.stringify(answer.provenance)],
        );
        await client.query(`UPDATE back_office_assistant_conversation SET last_message_at = $2 WHERE id = $1`, [id, sentAt]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        // Deleted while the assistant was replying: nothing is saved.
        if ((error as { code?: string }).code === FOREIGN_KEY_VIOLATION) return { ok: false, error: "not_found" };
        throw error;
      } finally {
        client.release();
      }
      const conversation = id ? await find(administrator.id, id) : null;
      if (!conversation) return { ok: false, error: "not_found" }; // deleted meanwhile
      return { ok: true, conversation, reply: answer.reply, blocked, provenance: answer.provenance, at: sentAt.toISOString() };
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
      const messages = await lastMessages(conversation.id, null);
      return {
        ...conversation,
        messages: messages.map(({ from, text, blocked, provenance, at }) => ({
          from,
          text,
          ...(blocked ? { blocked: true as const } : {}),
          ...(from === "assistant" ? { provenance: provenance ?? null, ...(at ? { at } : {}) } : {}),
        })),
      };
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
      -- The Administrator's Candidate account (Administrators are Candidates with a Back Office Role):
      -- named candidate_id like every table tied to an account, so deletion and export reach it.
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
    -- The Back Office sections each reply was told about (#205); null on the Administrator's messages.
    ALTER TABLE back_office_assistant_message ADD COLUMN IF NOT EXISTS sections text[];
    -- A Blocked message (#228): a question a Guardrail stopped, or the Guardrail message answering it or replacing a reply.
    ALTER TABLE back_office_assistant_message ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;
    -- What served each reply (ADR-0034, #327); null before (a partial one is read from provider and model).
    ALTER TABLE back_office_assistant_message ADD COLUMN IF NOT EXISTS provenance jsonb;
    -- The item an Explainable label asked about (#407), on the Administrator's message; null otherwise.
    ALTER TABLE back_office_assistant_message ADD COLUMN IF NOT EXISTS explained jsonb;
    CREATE INDEX IF NOT EXISTS back_office_assistant_message_conversation_idx ON back_office_assistant_message (conversation_id, seq);
  `);
}
