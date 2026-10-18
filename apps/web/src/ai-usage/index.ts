/**
 * AI Usage (CONTEXT.md, #218): what every AI call, the tools its model used, and every
 * external API call cost, for the Back Office's AI consumption report (Consommation IA).
 *
 * One module in front of Postgres:
 *  - `createPostgresUsageLog(database)`, the AI layer's UsageLog in the web app and the worker:
 *    one `ai_usage` row per call (task, provider, endpoint, model, tokens, estimated €, outcome,
 *    duration) and one `ai_tool_usage` row per tool its model used: no Candidate id, no text.
 *  - `createPostgresExternalApiLog(database)`, where `recordingFetch` records the calls to
 *    France Travail and the contact enrichment providers: `external_api_usage`, no payload.
 *  - `aiUsageReport(database, aiUsagePeriod(key, now))`: totals and breakdowns of a period.
 *  - `purgeExpiredAiUsage(database, now)`, run nightly by the worker: rows are kept RETENTION_MONTHS.
 * What each call said is kept apart, in the AI Message Log (`./message-log`), 30 days.
 * Recording never fails nor delays a call: an insert that fails is only warned about.
 * Aggregates of no one: these tables are not tied to a Candidate, so they stay out of the
 * data export and outlive account deletion.
 */
import type { UsageLog } from "@jobhub/ai";
import { scrubSecrets, type ExternalApiCall, type ExternalApiLog } from "@jobhub/shared";
import type { Pool } from "pg";

/** How long AI usage and external API calls are kept. */
export const RETENTION_MONTHS = 24;
/** How long the AI Message Log (what each call said: personal data) is kept. */
export const MESSAGE_LOG_RETENTION_DAYS = 30;

type Warn = (message: string, error: unknown) => void;

const defaultWarn: Warn = (message, error) => console.warn(`[ai-usage] ${message}:`, error instanceof Error ? error.message : error);

export interface PostgresUsageLogOptions {
  /** Where a failed insert is said. Default: console.warn. */
  warn?: Warn;
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
      try {
        const known = options.secrets?.() ?? [];
        const scrub = (text: string) => scrubSecrets(text, known);
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
           -- A Guest, or an id that is no Candidate's: kept without one.
           SELECT usage.id, (SELECT id FROM candidate WHERE id = $13), $1, $14, $15::jsonb, $16 FROM usage`,
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
            system === undefined ? null : scrub(system),
            JSON.stringify(messages.map((message) => ({ role: message.role, content: scrub(message.content) }))),
            reply === null ? null : scrub(reply),
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

const ROW = `count(*)::int AS calls, (count(*) FILTER (WHERE NOT ok))::int AS failures,
             coalesce(sum(input_tokens), 0)::float8 AS "inputTokens", coalesce(sum(output_tokens), 0)::float8 AS "outputTokens",
             coalesce(sum(cached_input_tokens), 0)::float8 AS "cachedInputTokens", coalesce(sum(cost), 0)::float8 AS "costEur"`;

/** `column` within the period: $1 and $2 are its Paris dates. */
const within = (column: string) => `${column} >= $1::timestamp AT TIME ZONE '${TIME_ZONE}' AND ${column} < $2::timestamp AT TIME ZONE '${TIME_ZONE}'`;

/** The period's AI calls (with their tools' fees in `cost`), Paris-time bucket included. */
const CALLS = `WITH calls AS (
  SELECT u.*, u.cost_eur + coalesce((SELECT sum(t.cost_eur) FROM ai_tool_usage t WHERE t.usage_id = u.id), 0) AS cost,
         to_char(u.at AT TIME ZONE '${TIME_ZONE}', $3) AS bucket
    FROM ai_usage u
   WHERE ${within("u.at")}
)`;

/** The AI consumption of `period`, as the Back Office's report shows it. Estimates at list prices, in €. */
export async function aiUsageReport(database: Pick<Pool, "query">, period: AiUsagePeriod): Promise<AiUsageReport> {
  const params = [period.from, period.to, period.per === "day" ? "YYYY-MM-DD" : "YYYY-MM"];
  const [total, byModel, byTask, byTime, tools, external] = await Promise.all([
    database.query<AiUsageRow>(`${CALLS} SELECT ${ROW} FROM calls`, params),
    database.query<AiUsageReport["byModel"][number]>(
      `${CALLS} SELECT provider, model, ${ROW} FROM calls GROUP BY provider, model ORDER BY calls DESC, provider, model`,
      params,
    ),
    database.query<AiUsageReport["byTask"][number]>(`${CALLS} SELECT task, ${ROW} FROM calls GROUP BY task ORDER BY calls DESC, task`, params),
    database.query<AiUsageReport["byTime"][number]>(`${CALLS} SELECT bucket, ${ROW} FROM calls GROUP BY bucket ORDER BY bucket DESC`, params),
    database.query<AiUsageReport["tools"][number]>(
      `SELECT u.provider, t.name, sum(t.count)::int AS calls, (count(*) FILTER (WHERE NOT t.ok))::int AS failures, sum(t.cost_eur)::float8 AS "costEur"
         FROM ai_tool_usage t JOIN ai_usage u ON u.id = t.usage_id
        WHERE ${within("u.at")}
        GROUP BY u.provider, t.name ORDER BY calls DESC, u.provider, t.name`,
      params.slice(0, 2),
    ),
    database.query<AiUsageReport["externalApis"][number]>(
      `SELECT provider, operation, count(*)::int AS calls, (count(*) FILTER (WHERE NOT ok))::int AS failures, sum(cost_eur)::float8 AS "costEur"
         FROM external_api_usage WHERE ${within("at")}
        GROUP BY provider, operation ORDER BY calls DESC, provider, operation`,
      params.slice(0, 2),
    ),
  ]);
  const calls = total.rows[0]!;
  const toolCalls = tools.rows.reduce((sum, tool) => sum + tool.calls, 0);
  const toolsCostEur = tools.rows.reduce((sum, tool) => sum + (tool.costEur ?? 0), 0);
  const externalCalls = external.rows.reduce((sum, api) => sum + api.calls, 0);
  const externalFailures = external.rows.reduce((sum, api) => sum + api.failures, 0);
  const externalCostEur = external.rows.reduce((sum, api) => sum + (api.costEur ?? 0), 0);
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
    byModel: byModel.rows,
    byTask: byTask.rows,
    byTime: byTime.rows,
    tools: tools.rows,
    externalApis: external.rows,
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
    CREATE TABLE IF NOT EXISTS ai_tool_usage (
      id bigserial PRIMARY KEY,
      usage_id uuid NOT NULL REFERENCES ai_usage (id) ON DELETE CASCADE,
      name text NOT NULL,
      count integer NOT NULL,
      ok boolean NOT NULL,
      duration_ms integer NOT NULL,
      cost_eur double precision
    );
    CREATE INDEX IF NOT EXISTS ai_tool_usage_usage_idx ON ai_tool_usage (usage_id);
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
    CREATE INDEX IF NOT EXISTS ai_message_log_candidate_idx ON ai_message_log (candidate_id);
    CREATE INDEX IF NOT EXISTS ai_message_log_usage_idx ON ai_message_log (usage_id);
  `);
}
