/**
 * The Tools as the Back Office's Outils section shows them (#233): every Tool of the catalog
 * (`TOOLS`, @jobhub/shared), whether it is configured, and its calls as AI Usage recorded them.
 *
 *   toolStatus(tool, state)               configured, a key missing, not configured, or no key needed
 *   toolsOverview(database, state, now)   every Tool, by category, with its last 30 days' figures
 *   toolCalls(database, tool)             one Tool's latest calls, newest first
 *   latestToolCalls(database, options)    every Tool's latest calls together, newest first (the Journal)
 *
 * Read-only. Nothing here holds a payload or a secret: a key is only said to have a value or not,
 * and a call is its time, operation, outcome, duration and cost (`ai_usage`, `ai_tool_usage`,
 * `external_api_usage`), never what it said.
 */
import { externalApiProvidersOf, toolOfUsage, toolsByCategory, type RecordedCall, type Tool, type ToolCategory } from "@jobhub/shared";
import type { Pool } from "pg";

type Env = Record<string, string | undefined>;

/** What a Tool's status is read from. */
export interface ToolsState {
  /** The environment with the Provider Secrets over it: the values in use. */
  env: Env;
  /** The types of the Sign-in Providers enabled. */
  signInTypes: readonly string[];
}

export type ToolStatus = "configured" | "key_missing" | "not_configured" | "no_key_needed";

/** Whether `tool` can be called: every key it needs has a value; a sign-in Tool, a Sign-in Provider of its type is enabled. */
export function toolStatus(tool: Tool, state: ToolsState): { status: ToolStatus; missingKeys: string[] } {
  if (tool.signIn) return { status: state.signInTypes.includes(tool.signIn) ? "configured" : "not_configured", missingKeys: [] };
  if (tool.keys.length === 0) return { status: "no_key_needed", missingKeys: [] };
  const missingKeys = tool.keys.filter((key) => !state.env[key]?.trim());
  return { status: missingKeys.length === 0 ? "configured" : "key_missing", missingKeys };
}

/** How many calls a Tool had, how many failed, and their estimated € (null when no call's cost is known). */
export interface ToolFigures {
  calls: number;
  failures: number;
  costEur: number | null;
}

export interface ToolRow {
  tool: Tool;
  status: ToolStatus;
  missingKeys: string[];
  /** Over the last FIGURES_DAYS days; null when the Tool's calls are not recorded. */
  figures: ToolFigures | null;
}

/** How far back the overview's figures go. */
export const FIGURES_DAYS = 30;

/** The calls of the period per recorded provider (and endpoint, for AI calls); an AI call's cost counts its tools' fees. */
const FIGURES = `
  SELECT 'ai_usage' AS "table", u.provider, u.endpoint, count(*)::int AS calls, (count(*) FILTER (WHERE NOT u.ok))::int AS failures,
         sum(u.cost_eur + coalesce(fees.cost, 0)) AS "costEur"
    FROM ai_usage u
    LEFT JOIN LATERAL (SELECT sum(t.cost_eur) AS cost FROM ai_tool_usage t WHERE t.usage_id = u.id) fees ON true
   WHERE u.at >= $1
   GROUP BY u.provider, u.endpoint
  UNION ALL
  SELECT 'external_api_usage', provider, NULL, count(*)::int, (count(*) FILTER (WHERE NOT ok))::int, sum(cost_eur)
    FROM external_api_usage
   WHERE at >= $1
   GROUP BY provider`;

/** Every Tool, by category, with its status and its calls of the last FIGURES_DAYS days before `now`. */
export async function toolsOverview(database: Pick<Pool, "query">, state: ToolsState, now: Date): Promise<{ category: ToolCategory; rows: ToolRow[] }[]> {
  const since = new Date(now.getTime() - FIGURES_DAYS * 86_400_000);
  const { rows } = await database.query<{ table: RecordedCall["table"]; provider: string; endpoint: string | null; calls: number; failures: number; costEur: number | null }>(
    FIGURES,
    [since],
  );
  const figures = new Map<string, ToolFigures>();
  for (const row of rows) {
    const call: RecordedCall = row.table === "ai_usage" ? { table: row.table, provider: row.provider, endpoint: row.endpoint ?? "" } : { table: row.table, provider: row.provider };
    const tool = toolOfUsage(call);
    // An unregistered provider (the guard test keeps them out) is in no Tool's figures.
    if (!tool) continue;
    const sum = figures.get(tool.id) ?? { calls: 0, failures: 0, costEur: null };
    figures.set(tool.id, {
      calls: sum.calls + row.calls,
      failures: sum.failures + row.failures,
      costEur: row.costEur === null ? sum.costEur : (sum.costEur ?? 0) + row.costEur,
    });
  }
  return toolsByCategory().map(({ category, tools }) => ({
    category,
    rows: tools.map((tool) => ({
      tool,
      ...toolStatus(tool, state),
      figures: tool.usage ? (figures.get(tool.id) ?? { calls: 0, failures: 0, costEur: null }) : null,
    })),
  }));
}

/** One call to a Tool, as its Outils page lists it. */
export interface ToolCall {
  at: Date;
  /** An API call's method and path (no query string); an AI call's task and model. */
  operation: string;
  ok: boolean;
  /** Null for an AI call, and when no answer came. */
  httpStatus: number | null;
  durationMs: number;
  /** Null when not known. */
  costEur: number | null;
}

/** How many calls a Tool's page lists by default. */
export const LATEST_CALLS = 50;

/** An external API call's columns, as a ToolCall. */
const EXTERNAL_CALL = `at, operation, ok, http_status AS "httpStatus", duration_ms AS "durationMs", cost_eur AS "costEur"`;
/** An AI call's columns, as a ToolCall: its cost counts its tools' fees. */
const AI_CALL = `u.at, u.task || ' · ' || u.model AS operation, u.ok, NULL::int AS "httpStatus", u.duration_ms AS "durationMs",
            u.cost_eur + coalesce((SELECT sum(t.cost_eur) FROM ai_tool_usage t WHERE t.usage_id = u.id), 0) AS "costEur"`;

/** `tool`'s latest calls, newest first, its AI calls and its other calls together; none when its calls are not recorded. */
export async function toolCalls(database: Pick<Pool, "query">, tool: Tool, options: { limit?: number } = {}): Promise<ToolCall[]> {
  const limit = options.limit ?? LATEST_CALLS;
  const usage = tool.usage;
  if (!usage) return [];
  const external = `SELECT ${EXTERNAL_CALL}, lpad(id::text, 20, '0') AS id FROM external_api_usage WHERE provider = ANY($1::text[])`;
  const { rows } =
    usage.table === "external_api_usage"
      ? await database.query<ToolCall>(`SELECT ${EXTERNAL_CALL} FROM external_api_usage WHERE provider = ANY($1::text[]) ORDER BY at DESC, id DESC LIMIT $2`, [
          externalApiProvidersOf(tool),
          limit,
        ])
      : await database.query<ToolCall>(
          `SELECT at, operation, ok, "httpStatus", "durationMs", "costEur" FROM (
             ${external}
             UNION ALL
             SELECT ${AI_CALL}, u.id::text FROM ai_usage u WHERE u.provider = $2 AND starts_with(u.endpoint, $3)
           ) calls ORDER BY at DESC, id DESC LIMIT $4`,
          [externalApiProvidersOf(tool), usage.provider, usage.endpoint ?? "", limit],
        );
  return rows;
}

/** A call, with the Tool it was made to. */
export interface CalledTool {
  tool: Tool;
  call: ToolCall;
}

/**
 * Every Tool's latest calls together, newest first: at most `limit`, made at or after `since`
 * when given, and only those that succeeded (`ok: true`) or failed (`ok: false`) when given, the
 * limit counting only those. A call to a provider no Tool holds (the guard test keeps them out) is
 * left out.
 */
export async function latestToolCalls(database: Pick<Pool, "query">, options: { limit?: number; since?: Date; ok?: boolean } = {}): Promise<CalledTool[]> {
  const { rows } = await database.query<ToolCall & { table: RecordedCall["table"]; provider: string; endpoint: string | null }>(
    `SELECT "table", provider, endpoint, at, operation, ok, "httpStatus", "durationMs", "costEur" FROM (
       SELECT 'external_api_usage' AS "table", provider, NULL AS endpoint, ${EXTERNAL_CALL}, lpad(id::text, 20, '0') AS id FROM external_api_usage
         WHERE ($1::timestamptz IS NULL OR at >= $1) AND ($3::boolean IS NULL OR ok = $3)
       UNION ALL
       SELECT 'ai_usage', u.provider, u.endpoint, ${AI_CALL}, u.id::text FROM ai_usage u
         WHERE ($1::timestamptz IS NULL OR u.at >= $1) AND ($3::boolean IS NULL OR u.ok = $3)
     ) calls ORDER BY at DESC, "table", id DESC LIMIT $2`,
    [options.since ?? null, options.limit ?? LATEST_CALLS, options.ok ?? null],
  );
  return rows.flatMap(({ table, provider, endpoint, ...call }) => {
    const tool = toolOfUsage(table === "ai_usage" ? { table, provider, endpoint: endpoint ?? "" } : { table, provider });
    return tool ? [{ tool, call }] : [];
  });
}
