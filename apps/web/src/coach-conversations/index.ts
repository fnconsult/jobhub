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
 * with its focus: the page's object in view when it was asked (an Application, a Job Offer or a Profile), for AI Activity.
 * A reply saved before Provenance was kept gets a partial one, read on the fly from its provider, model and tokens.
 * A reply to a Job Offer link is saved with its Job Offer card, which reopens with the conversation, `followed`
 * once the Candidate has saved that Job Offer as an Application; the AI Coach is only ever given the reply's text.
 * Kept RETENTION_MONTHS after their last message (`purgeStaleCoachConversations`,
 * run daily by the worker) and deleted with the account (ADR-0010). Human
 * Coaches never read them: Coach Access covers Profiles and Applications only.
 */
import { activityOf } from "@jobhub/ai";
import { readProvenance, type JobOffer, type Provenance } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import { COACH_FOCUS_KINDS, type Coach, type CoachMessageCost, type PlaybookConsultation, type PlaybookUsed } from "../coach";
import { MAX_MESSAGE_LENGTH, MAX_MESSAGES, type CoachMessage, type JobOfferCard } from "../coach/conversation";
import type { GuardrailLanguage } from "../guardrails";
import type { Profiles } from "../profiles";

export interface CoachConversationSummary {
  id: string;
  title: string;
  /** The Profile in view when the conversation started, if any. */
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
    }
  | { ok: false; error: "invalid" | "not_found" | "unavailable" };

export type RenameResult = { ok: true; conversation: CoachConversationSummary } | { ok: false; error: "invalid" | "not_found" };

export interface CoachConversations {
  send(candidateId: string, input: unknown, options?: { language?: GuardrailLanguage }): Promise<SendResult>;
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

/** The page objects a reply's focus can be (#327): what AI Activity counts the reply with. */
const FOCUS_KINDS = ["application", "job_offer", "profile"] as const;
type FocusKind = (typeof FOCUS_KINDS)[number];

/** The reply's focus: the page's object in view, when it is an Application, a Job Offer or a Profile, by its id. */
function focusOf(focus: FocusInput): { kind: FocusKind; id: string } | null {
  if (!focus || !(FOCUS_KINDS as readonly string[]).includes(focus.kind) || !UUID.test(focus.id)) return null;
  return { kind: focus.kind as FocusKind, id: focus.id };
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

interface ConversationRow {
  id: string;
  title: string;
  profile_id: string | null;
  profile_name: string | null;
  last_message_at: Date;
  ai_disclosure: boolean;
}

const SUMMARY = `SELECT c.id, c.title, c.profile_id, p.name AS profile_name, c.last_message_at, c.ai_disclosure
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
  async function findRow(candidateId: string, conversationId: string): Promise<ConversationRow | null> {
    if (!UUID.test(conversationId)) return null;
    const { rows } = await database.query<ConversationRow>(`${SUMMARY} WHERE c.id = $1 AND c.candidate_id = $2`, [conversationId, candidateId]);
    return rows[0] ?? null;
  }
  async function find(candidateId: string, conversationId: string): Promise<CoachConversationSummary | null> {
    const row = await findRow(candidateId, conversationId);
    return row ? summaryFrom(row) : null;
  }

  /** The last `limit` messages of the Candidate's conversation, oldest first, each reply with its Job Offer card. */
  async function lastMessages(candidateId: string, conversationId: string, limit: number | null): Promise<CoachMessage[]> {
    const { rows } = await database.query<MessageRow>(
      `SELECT recent.author AS "from", recent.text, recent.blocked,
              CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object('id', o.id, 'title', o.title, 'employer', o.employer, 'followed', a.id IS NOT NULL)) END AS "jobOffer",
              ${SAVED_REPLY_COLUMNS.replaceAll("m.", "recent.")}
         FROM (SELECT * FROM coach_message WHERE conversation_id = $1 ORDER BY seq DESC LIMIT $2) recent
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

  return {
    async send(candidateId, input, options = {}) {
      const parsed = sendSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const { conversationId, message, focus } = parsed.data;

      const existing = conversationId ? await find(candidateId, conversationId) : null;
      if (conversationId && !existing) return { ok: false, error: "not_found" };
      const history = existing ? await lastMessages(candidateId, existing.id, MAX_MESSAGES) : [];

      const answer = await deps.coach.reply(
        candidateId,
        {
          messages: [...withoutBlockedMessages(history).map(({ from, text }) => ({ from, text })), { from: "candidate", text: message }],
          ...(focus ? { focus: { kind: focus.kind, id: focus.id } } : {}),
        },
        options.language ? { language: options.language } : undefined,
      );
      if (!answer.ok) return answer;

      const sentAt = now();
      const { cost } = answer;
      const replyFocus = focusOf(focus);
      const blocked = { message: answer.outcome === "blocked_message", reply: answer.outcome === "blocked_message" || answer.outcome === "blocked_reply" };
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        let id = existing?.id;
        if (!id) {
          const profileId = await profileInView(candidateId, focus);
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO coach_conversation (candidate_id, profile_id, title, created_at, last_message_at, ai_disclosure) VALUES ($1, $2, $3, $4, $4, true) RETURNING id`,
            [candidateId, profileId, titleFrom(message), sentAt],
          );
          id = rows[0]!.id;
        }
        await client.query(`INSERT INTO coach_message (conversation_id, author, text, created_at, blocked) VALUES ($1, 'candidate', $2, $3, $4)`, [id, message, sentAt, blocked.message]);
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
            blocked.reply,
            answer.jobOffer?.id ?? null,
            JSON.stringify(answer.provenance),
            replyFocus?.kind ?? null,
            replyFocus?.id ?? null,
          ],
        );
        await client.query(`UPDATE coach_conversation SET last_message_at = $2 WHERE id = $1`, [id, sentAt]);
        await client.query("COMMIT");
        const conversation = await find(candidateId, id);
        if (!conversation) return { ok: false, error: "not_found" }; // deleted meanwhile
        return {
          ok: true,
          conversation,
          reply: answer.reply,
          blocked,
          ...(answer.jobOffer ? { jobOffer: await cardOf(candidateId, answer.jobOffer) } : {}),
          provenance: answer.provenance,
          at: sentAt.toISOString(),
        };
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
      const row = await findRow(candidateId, conversationId);
      if (!row) return null;
      return { ...summaryFrom(row), aiDisclosure: row.ai_disclosure, messages: await lastMessages(candidateId, row.id, null) };
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

/** Creates or upgrades the Coach Conversation tables. Run after the Profile, Job Offer and Application tables. Safe to run repeatedly. */
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
    -- The page's object in view when a reply was asked (#327): an Application, a Job Offer or a Profile; null otherwise and before.
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS focus_kind text CHECK (focus_kind IN ('application', 'job_offer', 'profile'));
    ALTER TABLE coach_message ADD COLUMN IF NOT EXISTS focus_id uuid;
    CREATE INDEX IF NOT EXISTS coach_message_focus_idx ON coach_message (focus_kind, focus_id) WHERE focus_id IS NOT NULL;
    -- Whether the conversation opened with the AI disclosure (#324): true for every new one, false for those saved before.
    ALTER TABLE coach_conversation ADD COLUMN IF NOT EXISTS ai_disclosure boolean NOT NULL DEFAULT false;
  `);
}
