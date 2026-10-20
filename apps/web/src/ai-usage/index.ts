/**
 * AI Usage (CONTEXT.md, #218): what every AI call, the tools its model used, and every
 * external API call cost, for the Back Office's AI consumption report (Consommation IA).
 *
 * One module in front of Postgres:
 *  - `createPostgresUsageLog(database)`, the AI layer's UsageLog in the web app and the worker:
 *    one `ai_usage` row per call (task, provider, endpoint, model, tokens, estimated €, outcome,
 *    duration) and one `ai_tool_usage` row per tool its model used: no Candidate id, no text.
 *  - `createPostgresExternalApiLog(database)`, where `recordingFetch` records the calls to
 *    France Travail, Fantastic.jobs and the contact enrichment providers: `external_api_usage`, no payload.
 *  - `aiUsageReport(database, aiUsagePeriod(key, now))`: totals and breakdowns of a period.
 *  - `purgeExpiredAiUsage(database, now)`, run nightly by the worker: rows are kept RETENTION_MONTHS.
 * What each call said is kept apart, in the AI Message Log (`./message-log`), 30 days.
 * Recording never fails nor delays a call: an insert that fails is only warned about.
 * Aggregates of no one: these tables are not tied to a Candidate, so they stay out of the
 * data export and outlive account deletion.
 */
import type { Message, UsageLog } from "@jobhub/ai";
import { scrubStoredText, type ExternalApiCall, type ExternalApiLog } from "@jobhub/shared";
import type { Pool } from "pg";

/** How long AI usage and external API calls are kept. */
export const RETENTION_MONTHS = 24;
/** How long the AI Message Log (what each call said: personal data) is kept. */
export const MESSAGE_LOG_RETENTION_DAYS = 30;
/** The longest text the AI Message Log keeps of a call's system text, of its messages (all together) and of its reply, in characters. */
export const MESSAGE_LOG_MAX_LENGTH = 200_000;

/** `text` cut to `max` characters, the cut said at its end. */
function capped(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated: ${text.length - max} characters]`;
}

/** The messages within MESSAGE_LOG_MAX_LENGTH together, the latest kept first: an older one past it is cut, or emptied. */
function cappedMessages(messages: Message[]): Message[] {
  let left = MESSAGE_LOG_MAX_LENGTH;
  const kept: Message[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    kept.unshift({ role: message.role, content: capped(message.content, left) });
    left = Math.max(0, left - message.content.length);
  }
  return kept;
}

/**
 * Lets the caller's stack (the AI call) go on before any work is done: a timer, not setImmediate,
 * which Next.js replaces in its server with one that can leave such a callback unrun.
 */
const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Warn = (message: string, error: unknown) => void;

const defaultWarn: Warn = (message, error) => console.warn(`[ai-usage] ${message}:`, error instanceof Error ? error.message : error);

export interface PostgresUsageLogOptions {
  /** Where a failed insert is said. Default: console.warn. */
  warn?: Warn;
}

/** An environment variable holding a credential, by its name; France Travail's client id and SMTP_URL (it carries a password) too. */
const CREDENTIAL = /KEY|TOKEN|SECRET|PASSWORD|^FRANCE_TRAVAIL_CLIENT_ID$|^SMTP_URL$/;

/** The values of every key, token, secret and password in `env`: what the AI Message Log scrubs by value. */
export function knownSecrets(env: Record<string, string | undefined>): string[] {
  return Object.entries(env).flatMap(([name, value]) => (CREDENTIAL.test(name) && value?.trim() ? [value] : []));
}

export interface PostgresAiUsageLogOptions extends PostgresUsageLogOptions {
  /** The keys in use (Provider Secrets and the environment's), scrubbed from the AI Message Log on top of whatever looks like a key. */
  secrets?: () => readonly (string | undefined)[];
}

/**
 * The AI layer's usage log on Postgres: the call's usage and tools, and what it said in the AI Message
 * Log (`./message-log`), secrets scrubbed, with its Candidate when there is one. All of it or nothing.
 * `record` never rejects: a failed insert is warned about.
 */
export function createPostgresUsageLog(database: Pick<Pool, "query">, options: PostgresAiUsageLogOptions = {}): UsageLog {
  const warn = options.warn ?? defaultWarn;
  return {
    async record(entry) {
      // Nothing on the AI call's own stack: scrubbing a long prompt waits for the next turn.
      await nextTurn();
      try {
        const known = options.secrets?.() ?? [];
        const scrub = (text: string) => scrubStoredText(text, known);
        const { system, messages, reply } = entry.transcript;
        await database.query(
          `WITH usage AS (
             INSERT INTO ai_usage (at, task, provider, endpoint, model, input_tokens, output_tokens, cached_input_tokens, cost_eur, ok, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id
           ), tools AS (
             INSERT INTO ai_tool_usage (usage_id, name, count, ok, duration_ms, cost_eur)
             SELECT usage.id, tool.name, tool.count, tool.ok, tool."durationMs", tool."costEur"
               FROM usage, jsonb_to_recordset($12::jsonb) AS tool (name text, count integer, ok boolean, "durationMs" integer, "costEur" double precision)
           )
           INSERT INTO ai_message_log (usage_id, candidate_id, at, system, messages, reply)
           -- A Guest's call is kept without a Candidate; a Candidate's only while they exist: never a log without its owner.
           SELECT usage.id, $13, $1, $14, $15::jsonb, $16 FROM usage
            WHERE $13::text IS NULL OR EXISTS (SELECT 1 FROM candidate WHERE id = $13)`,
          [
            entry.at,
            entry.task,
            entry.provider,
            entry.endpoint,
            entry.model,
            entry.inputTokens,
            entry.outputTokens,
            entry.cachedInputTokens ?? 0,
            entry.costEur,
            entry.ok,
            entry.durationMs,
            JSON.stringify(entry.tools),
            entry.candidateId,
            system === undefined ? null : capped(scrub(system), MESSAGE_LOG_MAX_LENGTH),
            JSON.stringify(cappedMessages(messages.map((message) => ({ role: message.role, content: scrub(message.content) })))),
            reply === null ? null : capped(scrub(reply), MESSAGE_LOG_MAX_LENGTH),
          ],
        );
      } catch (error) {
        warn("AI usage not recorded", error);
      }
    },
  };
}

/** Where `recordingFetch` records external API calls, on Postgres. `record` never rejects: a failed insert is warned about. */
export function createPostgresExternalApiLog(database: Pick<Pool, "query">, options: PostgresUsageLogOptions = {}): ExternalApiLog {
  const warn = options.warn ?? defaultWarn;
  return {
    async record(call: ExternalApiCall) {
      try {
        await database.query(
          `INSERT INTO external_api_usage (at, provider, operation, ok, http_status, duration_ms, cost_eur) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [call.at, call.provider, call.operation, call.ok, call.httpStatus, call.durationMs, call.costEur],
        );
      } catch (error) {
        warn("External API call not recorded", error);
      }
    },
  };
}

/** The periods the report reads: the last 7, 30 or 90 days, the last 12 months, or one of them ("2026-09"). */
export type AiUsagePeriodKey = "7d" | "30d" | "90d" | "12m" | `${number}-${number}`;

/** A period, in Paris dates: from `from` (included) to `to` (excluded), broken down per day or per month. */
export interface AiUsagePeriod {
  key: AiUsagePeriodKey;
  /** "2026-10-12". */
  from: string;
  to: string;
  per: "day" | "month";
}

export const DEFAULT_PERIOD = "30d";
const DAY_PERIODS = { "7d": 7, "30d": 30, "90d": 90 } as const;
const MONTHS = 12;
const TIME_ZONE = "Europe/Paris";

/** Today in Paris, as a UTC midnight Date for calendar arithmetic. */
function parisToday(now: Date): Date {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${day}T00:00:00Z`);
}

const dateOf = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const addMonths = (date: Date, months: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
const monthOf = (date: Date) => dateOf(date).slice(0, 7);

/** The last 12 months, this one first: "2026-10", "2026-09"... */
export function aiUsageMonths(now: Date): string[] {
  const month = addMonths(parisToday(now), 0);
  return Array.from({ length: MONTHS }, (_, back) => monthOf(addMonths(month, -back)));
}

/** The period a key names (untrusted: from the page's query string); the last 30 days for anything else. */
export function aiUsagePeriod(key: unknown, now: Date): AiUsagePeriod {
  const today = parisToday(now);
  const tomorrow = dateOf(addDays(today, 1));
  if (typeof key === "string" && key in DAY_PERIODS) {
    const days = DAY_PERIODS[key as keyof typeof DAY_PERIODS];
    return { key: key as AiUsagePeriodKey, from: dateOf(addDays(today, 1 - days)), to: tomorrow, per: "day" };
  }
  const thisMonth = addMonths(today, 0);
  if (key === "12m") return { key, from: dateOf(addMonths(thisMonth, 1 - MONTHS)), to: dateOf(addMonths(thisMonth, 1)), per: "month" };
  if (typeof key === "string" && aiUsageMonths(now).includes(key)) {
    const month = new Date(`${key}-01T00:00:00Z`);
    return { key: key as AiUsagePeriodKey, from: dateOf(month), to: dateOf(addMonths(month, 1)), per: "day" };
  }
  return aiUsagePeriod(DEFAULT_PERIOD, now);
}

/** Calls, failures, tokens and cost of a group of AI calls; the cost counts their tools' fees. */
export interface AiUsageRow {
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costEur: number;
}

export interface AiUsageReport {
  period: AiUsagePeriod;
  totals: {
    /** AI calls, failed ones, and their tokens. */
    calls: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    /** The AI calls' estimated €: tokens and tools' fees. */
    callsCostEur: number;
    /** Tool uses, and their fees (part of `callsCostEur`). */
    toolCalls: number;
    toolsCostEur: number;
    externalCalls: number;
    externalFailures: number;
    /** Of the external calls whose cost is known. */
    externalCostEur: number;
    /** Everything: AI calls with their tools, and external APIs. */
    costEur: number;
  };
  /** Most calls first. */
  byModel: (AiUsageRow & { provider: string; model: string })[];
  byTask: (AiUsageRow & { task: string })[];
  /** Per day ("2026-10-17") or per month ("2026-10"), Paris time, newest first; only those with calls. */
  byTime: (AiUsageRow & { bucket: string })[];
  /** Per provider and tool, most uses first; `calls` counts each use. */
  tools: { provider: string; name: string; calls: number; failures: number; costEur: number | null }[];
  /** Per provider and operation, most calls first. `costEur` is null when no call's cost is known. */
  externalApis: { provider: string; operation: string; calls: number; failures: number; costEur: number | null }[];
}

/** `column` within the period: $1 and $2 are its Paris dates. */
const within = (column: string) => `${column} >= $1::timestamp AT TIME ZONE '${TIME_ZONE}' AND ${column} < $2::timestamp AT TIME ZONE '${TIME_ZONE}'`;

/** Calls, failures, tokens and cost of a group of the `calls` below, as JSON. */
const ROW = `'calls', count(*), 'failures', count(*) FILTER (WHERE NOT ok),
             'inputTokens', coalesce(sum(input_tokens), 0), 'outputTokens', coalesce(sum(output_tokens), 0),
             'cachedInputTokens', coalesce(sum(cached_input_tokens), 0), 'costEur', coalesce(sum(cost), 0)`;

/**
 * The whole report in one query. `calls`, the period's AI calls with their tools' fees in `cost`
 * and their Paris-time bucket, is computed once (MATERIALIZED) and grouped each way from there;
 * the tools are summed per call with a GROUP BY, not a query per call.
 */
const REPORT = `
  WITH tools AS MATERIALIZED (
    SELECT u.id AS usage_id, u.provider, t.name, t.count, t.ok, t.cost_eur
      FROM ai_usage u JOIN ai_tool_usage t ON t.usage_id = u.id
     WHERE ${within("u.at")}
  ), calls AS MATERIALIZED (
    SELECT u.provider, u.model, u.task, u.ok, u.input_tokens, u.output_tokens, u.cached_input_tokens,
           u.cost_eur + coalesce(fees.cost, 0) AS cost, to_char(u.at AT TIME ZONE '${TIME_ZONE}', $3) AS bucket
      FROM ai_usage u
      LEFT JOIN (SELECT usage_id, sum(cost_eur) AS cost FROM tools GROUP BY usage_id) fees ON fees.usage_id = u.id
     WHERE ${within("u.at")}
  )
  SELECT
    (SELECT json_build_object(${ROW}) FROM calls) AS total,
    (SELECT coalesce(json_agg(row ORDER BY (row->>'calls')::int DESC, row->>'provider', row->>'model'), '[]')
       FROM (SELECT json_build_object('provider', provider, 'model', model, ${ROW})::jsonb AS row FROM calls GROUP BY provider, model) g) AS "byModel",
    (SELECT coalesce(json_agg(row ORDER BY (row->>'calls')::int DESC, row->>'task'), '[]')
       FROM (SELECT json_build_object('task', task, ${ROW})::jsonb AS row FROM calls GROUP BY task) g) AS "byTask",
    (SELECT coalesce(json_agg(row ORDER BY row->>'bucket' DESC), '[]')
       FROM (SELECT json_build_object('bucket', bucket, ${ROW})::jsonb AS row FROM calls GROUP BY bucket) g) AS "byTime",
    -- Uses and failed uses in one unit: each row counts \`count\` uses.
    (SELECT coalesce(json_agg(row ORDER BY (row->>'calls')::int DESC, row->>'provider', row->>'name'), '[]')
       FROM (SELECT json_build_object('provider', provider, 'name', name, 'calls', sum(count), 'failures', coalesce(sum(count) FILTER (WHERE NOT ok), 0),
                                      'costEur', sum(cost_eur))::jsonb AS row
               FROM tools GROUP BY provider, name) g) AS tools,
    (SELECT coalesce(json_agg(row ORDER BY (row->>'calls')::int DESC, row->>'provider', row->>'operation'), '[]')
       FROM (SELECT json_build_object('provider', provider, 'operation', operation, 'calls', count(*), 'failures', count(*) FILTER (WHERE NOT ok),
                                      'costEur', sum(cost_eur))::jsonb AS row
               FROM external_api_usage WHERE ${within("at")} GROUP BY provider, operation) g) AS "externalApis"`;

/** The AI consumption of `period`, as the Back Office's report shows it. Estimates at list prices, in €. */
export async function aiUsageReport(database: Pick<Pool, "query">, period: AiUsagePeriod): Promise<AiUsageReport> {
  const { rows } = await database.query<Omit<AiUsageReport, "period" | "totals"> & { total: AiUsageRow }>(REPORT, [
    period.from,
    period.to,
    period.per === "day" ? "YYYY-MM-DD" : "YYYY-MM",
  ]);
  const { total: calls, byModel, byTask, byTime, tools, externalApis } = rows[0]!;
  const toolCalls = tools.reduce((sum, tool) => sum + tool.calls, 0);
  const toolsCostEur = tools.reduce((sum, tool) => sum + (tool.costEur ?? 0), 0);
  const externalCalls = externalApis.reduce((sum, api) => sum + api.calls, 0);
  const externalFailures = externalApis.reduce((sum, api) => sum + api.failures, 0);
  const externalCostEur = externalApis.reduce((sum, api) => sum + (api.costEur ?? 0), 0);
  return {
    period,
    totals: {
      calls: calls.calls,
      failures: calls.failures,
      inputTokens: calls.inputTokens,
      outputTokens: calls.outputTokens,
      cachedInputTokens: calls.cachedInputTokens,
      callsCostEur: calls.costEur,
      toolCalls,
      toolsCostEur,
      externalCalls,
      externalFailures,
      externalCostEur,
      costEur: calls.costEur + externalCostEur,
    },
    byModel,
    byTask,
    byTime,
    tools,
    externalApis,
  };
}

/**
 * Deletes the AI Message Log MESSAGE_LOG_RETENTION_DAYS old or more at `now`, and the AI usage (with
 * its tools) and external API calls RETENTION_MONTHS old or more; says how many of each. Safe to run again.
 */
export async function purgeExpiredAiUsage(database: Pick<Pool, "query">, now: Date): Promise<{ usage: number; externalApis: number; messageLogs: number }> {
  const before = `$1::timestamptz - make_interval(months => $2)`;
  const messageLogs = await database.query(`DELETE FROM ai_message_log WHERE at <= $1::timestamptz - make_interval(days => $2)`, [
    now,
    MESSAGE_LOG_RETENTION_DAYS,
  ]);
  // Counted apart: a message log still kept goes with its usage.
  const usage = await database.query(`DELETE FROM ai_usage WHERE at <= ${before}`, [now, RETENTION_MONTHS]);
  const externalApis = await database.query(`DELETE FROM external_api_usage WHERE at <= ${before}`, [now, RETENTION_MONTHS]);
  return { usage: usage.rowCount ?? 0, externalApis: externalApis.rowCount ?? 0, messageLogs: messageLogs.rowCount ?? 0 };
}

/** Creates or upgrades the AI Usage tables and the AI Message Log. Run after the Candidate tables. Safe to run repeatedly. */
export async function migrateAiUsage(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      at timestamptz NOT NULL,
      task text NOT NULL,
      provider text NOT NULL,
      endpoint text NOT NULL,
      model text NOT NULL,
      input_tokens integer NOT NULL,
      output_tokens integer NOT NULL,
      cached_input_tokens integer NOT NULL DEFAULT 0,
      cost_eur double precision NOT NULL,
      ok boolean NOT NULL,
      duration_ms integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_usage_at_idx ON ai_usage (at);
    -- The Journaux IA filters, newest first.
    CREATE INDEX IF NOT EXISTS ai_usage_task_at_idx ON ai_usage (task, at DESC);
    CREATE INDEX IF NOT EXISTS ai_usage_model_at_idx ON ai_usage (model, at DESC);
    -- A Tool's latest calls, on its Outils page (#233).
    CREATE INDEX IF NOT EXISTS ai_usage_provider_at_idx ON ai_usage (provider, at DESC);
    CREATE TABLE IF NOT EXISTS ai_tool_usage (
      id bigserial PRIMARY KEY,
      usage_id uuid NOT NULL REFERENCES ai_usage (id) ON DELETE CASCADE,
      name text NOT NULL,
      count integer NOT NULL,
      ok boolean NOT NULL,
      duration_ms integer NOT NULL,
      cost_eur double precision
    );
    -- The report sums a period's tools from its calls: what it reads, in the index.
    DROP INDEX IF EXISTS ai_tool_usage_usage_idx;
    CREATE INDEX IF NOT EXISTS ai_tool_usage_usage_cover_idx ON ai_tool_usage (usage_id) INCLUDE (name, count, ok, cost_eur);
    CREATE TABLE IF NOT EXISTS external_api_usage (
      id bigserial PRIMARY KEY,
      at timestamptz NOT NULL,
      provider text NOT NULL,
      operation text NOT NULL,
      ok boolean NOT NULL,
      http_status integer,
      duration_ms integer NOT NULL,
      cost_eur double precision
    );
    CREATE INDEX IF NOT EXISTS external_api_usage_at_idx ON external_api_usage (at);
    CREATE INDEX IF NOT EXISTS external_api_usage_provider_at_idx ON external_api_usage (provider, at DESC);
    -- The AI Message Log: what each call said, secrets scrubbed. Personal data: kept 30 days,
    -- in the Candidate's data export, deleted with their account.
    CREATE TABLE IF NOT EXISTS ai_message_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      usage_id uuid NOT NULL REFERENCES ai_usage (id) ON DELETE CASCADE,
      candidate_id text REFERENCES candidate (id) ON DELETE CASCADE,
      at timestamptz NOT NULL,
      system text,
      messages jsonb NOT NULL,
      reply text
    );
    CREATE INDEX IF NOT EXISTS ai_message_log_at_idx ON ai_message_log (at DESC);
    -- A Candidate's logs, newest first (their data export, account deletion).
    DROP INDEX IF EXISTS ai_message_log_candidate_idx;
    CREATE INDEX IF NOT EXISTS ai_message_log_candidate_at_idx ON ai_message_log (candidate_id, at DESC);
    CREATE INDEX IF NOT EXISTS ai_message_log_usage_idx ON ai_message_log (usage_id);
  `);
}
