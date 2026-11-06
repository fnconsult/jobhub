/**
 * The AI Message Log (CONTEXT.md, #218): what each AI call said (its system text, messages and
 * reply, secrets scrubbed), kept MESSAGE_LOG_RETENTION_DAYS for quality and debugging. Written by
 * the AI layer's Postgres usage log (`createPostgresUsageLog`), with the call's Candidate when
 * there is one; purged with `purgeExpiredAiUsage`.
 *
 * Personal data, read by super-admins only (the `aiMessages` resource), on Activité › Appels IA (formerly Journaux IA):
 * `list` shows who, when, which task and model, the Outcome and Failure Reason, never the text, and for a call that wrote an
 * AI Coach reply, the reply's estimate of its context against the provider's count (`context`, ADR-0078, #731); `open`
 * shows the text and the technical reason, and writes
 * the view to the Back Office Audit, in the same transaction, so no log is read without a trace.
 * A Candidate's logs are in their data export and go with their account.
 */
import { SEARCH_TASK, TEXT_TASKS, type AiWarning, type Message } from "@jobhub/ai";
import { FAILURE_REASONS, OUTCOMES, type FailureReason, type Outcome, type TechnicalReason } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import type { BackOffice, BackOfficeActor } from "../admin/back-office";

export interface AiMessageLogSummary {
  id: string;
  at: Date;
  task: string;
  /** Null for a call stopped before any provider was chosen. */
  provider: string | null;
  model: string | null;
  outcome: Outcome;
  /** The Failure Reason's code; null when ok, and for a failure recorded before reasons were (#259). */
  reason: FailureReason | null;
  /** The codes of its feature's warnings (#260): a warning's reason first; beside a failed call's own reason. */
  warnings: FailureReason[];
  /** False for a call stopped before it was sent (missing key or route, data residency). */
  sent: boolean;
  /** Null for a call made for no Candidate (a Guest). */
  candidate: { id: string; email: string } | null;
  /**
   * For a call that served an AI Coach reply (#731, ADR-0078; #790 for every call of it, not only the one that wrote it): the
   * reply's estimate of the context it was sent (`context_tokens`, about 4 characters a token), the provider's count of the input
   * of the reply's first Turn (`measure`: what the estimate is of, its input read from the prompt cache included) and their
   * `gap` (measure − estimate); and `reply`, the whole reply as its Coach Message Cost sums it, across all its calls. Null for
   * any other call, and for a reply that kept no estimate.
   */
  context: ContextMeasure | null;
}

/**
 * An AI Coach reply's context: what was estimated, what the provider counted of the call it was sent with, and the gap between
 * them; then what the whole reply sent (#790): its `calls` (the Playbook Agent choice, the Playbook Agents, each Turn, each
 * Guardrail check), their input `total` (cached included), of which `cached`, and the `gap` of that total over the estimate;
 * `rounds`, the Tool rounds, and `tools`, the Tools that ran. `turn`: which Turn of the reply written this call is (1 for the
 * first), null for another of its calls. `reply` is null for a reply saved before #790.
 */
export interface ContextMeasure {
  estimate: number;
  measure: number;
  gap: number;
  turn?: number | null;
  reply?: { calls: number; total: number; cached: number; gap: number; rounds: number; tools: string[] } | null;
}

export interface AiMessageLog extends AiMessageLogSummary {
  system: string | null;
  messages: Message[];
  /** Null when the call failed. */
  reply: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costEur: number;
  durationMs: number;
  /** What the error said (class, provider, HTTP status, message: scrubbed, redacted, cut); null when ok. */
  technicalReason: TechnicalReason | null;
  /** Each warning with what happened (written by the code, scrubbed, redacted by shape, cut). */
  warningDetails: AiWarning[];
}

export interface AiMessageLogs {
  /**
   * The newest logs first, at most LIST_LIMIT. `filter` is untrusted (the page's query string):
   * `{ task?, model?, email?, day?, outcome?, reason?, candidate?, from?, to? }`, `day` a Paris date ("2026-10-17"), `candidate` a
   * Candidate's id and `from` / `to` ISO instants (a Job discovery run's calls, #404); a field that cannot be read is ignored.
   */
  list(filter?: unknown): Promise<AiMessageLogSummary[]>;
  /** One log with its text, the view written to the Back Office Audit; null (nothing written) when there is none. */
  open(actor: BackOfficeActor, id: string): Promise<AiMessageLog | null>;
}

/** How many logs the list shows at most. */
export const LIST_LIMIT = 200;

export const AI_TASKS = [...Object.keys(TEXT_TASKS), SEARCH_TASK];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Each field on its own: one that cannot be read is dropped, the others still filter. */
const filterSchema = z.object({
  task: z.enum(AI_TASKS as [string, ...string[]]).optional().catch(undefined),
  model: z.string().trim().min(1).max(200).optional().catch(undefined),
  email: z.string().trim().toLowerCase().min(1).max(320).optional().catch(undefined),
  day: z.iso.date().optional().catch(undefined),
  outcome: z.enum(OUTCOMES).optional().catch(undefined),
  reason: z.enum(FAILURE_REASONS).optional().catch(undefined),
  // One Candidate's calls between two instants: a Job discovery run's, from Activité › Recherches (#404).
  candidate: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().catch(undefined),
  from: z.iso.datetime().optional().catch(undefined),
  to: z.iso.datetime().optional().catch(undefined),
});

export type AiMessageLogFilter = z.infer<typeof filterSchema>;

/** The filter of an untrusted input, every unreadable field left out. */
export function aiMessageLogFilter(input: unknown): AiMessageLogFilter {
  const parsed = filterSchema.safeParse(typeof input === "object" && input !== null ? input : {});
  return parsed.success ? Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)) : {};
}

const SUMMARY = `SELECT m.id, m.at, u.task, u.provider, u.model, u.outcome, u.reason, u.warnings, m.sent,
                        CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object('id', c.id, 'email', c.email) END AS candidate,
                        -- The AI Coach reply the call served, if any (#731, #790): its estimate against the provider's count of its
                        -- first Turn, and the whole reply's calls summed. Found by any of its calls, or the one that wrote it before #790.
                        (SELECT json_build_object('estimate', r.context_tokens, 'measure', f.sent, 'gap', f.sent - r.context_tokens,
                                                  'turn', array_position(r.ai_turn_ids, u.id),
                                                  'reply', CASE WHEN r.ai_call_ids IS NULL THEN NULL ELSE
                                                    (SELECT json_build_object('calls', cardinality(r.ai_call_ids),
                                                                              'total', coalesce(sum(a.input_tokens + a.cached_input_tokens), 0)::int,
                                                                              'cached', coalesce(sum(a.cached_input_tokens), 0)::int,
                                                                              'gap', coalesce(sum(a.input_tokens + a.cached_input_tokens), 0)::int - r.context_tokens,
                                                                              'rounds', coalesce(r.tool_rounds, 0), 'tools', to_jsonb(coalesce(r.tool_names, '{}')))
                                                       FROM ai_usage a WHERE a.id = ANY (r.ai_call_ids)) END)
                           FROM coach_message r
                          CROSS JOIN LATERAL (SELECT coalesce((SELECT a.input_tokens + a.cached_input_tokens FROM ai_usage a
                                                                WHERE a.id = coalesce(r.ai_turn_ids[1], r.ai_call_id)), 0) AS sent) f
                          WHERE (r.ai_call_id = u.id OR r.ai_call_ids @> ARRAY[u.id]) AND r.context_tokens IS NOT NULL LIMIT 1) AS context`;
const FROM = `FROM ai_message_log m JOIN ai_usage u ON u.id = m.usage_id LEFT JOIN candidate c ON c.id = m.candidate_id`;

export function createAiMessageLogs(database: Pool, deps: { backOffice: Pick<BackOffice, "record"> }): AiMessageLogs {
  return {
    async list(input) {
      const filter = aiMessageLogFilter(input);
      const conditions: string[] = [];
      const params: unknown[] = [];
      const where = (condition: (param: string) => string, value: unknown) => {
        params.push(value);
        conditions.push(condition(`$${params.length}`));
      };
      if (filter.task) where((param) => `u.task = ${param}`, filter.task);
      if (filter.model) where((param) => `u.model = ${param}`, filter.model);
      if (filter.email) where((param) => `lower(c.email) = ${param}`, filter.email);
      if (filter.outcome) where((param) => `u.outcome = ${param}`, filter.outcome);
      // A code, whether the call's reason or one of its warnings (a failed call's).
      if (filter.reason) where((param) => `(u.reason = ${param} OR ${param} = ANY (u.warnings))`, filter.reason);
      if (filter.day) where((param) => `(m.at AT TIME ZONE 'Europe/Paris')::date = ${param}::date`, filter.day);
      if (filter.candidate) where((param) => `m.candidate_id = ${param}`, filter.candidate);
      if (filter.from) where((param) => `m.at >= ${param}::timestamptz`, filter.from);
      if (filter.to) where((param) => `m.at <= ${param}::timestamptz`, filter.to);
      params.push(LIST_LIMIT);
      const { rows } = await database.query<AiMessageLogSummary>(
        `${SUMMARY} ${FROM} ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY m.at DESC, m.id LIMIT $${params.length}`,
        params,
      );
      return rows;
    },

    async open(actor, id) {
      if (!UUID.test(id)) return null;
      return deps.backOffice.record(
        actor,
        async (within) => {
          const { rows } = await within.query<AiMessageLog>(
            `${SUMMARY}, m.system, m.messages, m.reply, u.input_tokens AS "inputTokens", u.output_tokens AS "outputTokens",
                    u.cached_input_tokens AS "cachedInputTokens", u.cost_eur AS "costEur", u.duration_ms AS "durationMs",
                    m.technical_reason AS "technicalReason", m.warnings AS "warningDetails"
               ${FROM} WHERE m.id = $1`,
            [id],
          );
          return rows[0] ?? null;
        },
        (log) => (log ? { section: "ai_messages", target: log.id, action: "viewed", before: null, after: null } : null),
      );
    },
  };
}
