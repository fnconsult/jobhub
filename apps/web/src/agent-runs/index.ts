/**
 * Agent Run log: one row per agent run made by a delivery workflow (e.g.
 * `wf-dev`), so time, tokens and rounds spent per issue can be followed up.
 *
 * Callers get:
 *  - `migrateAgentRunLog(pool)` — creates the table and its indexes; safe to re-run;
 *  - `recordAgentRun(pool, run)` — validates and inserts one Agent Run;
 *  - `agentRunFromArgs(argv)` — reads an Agent Run from `npm run wf:record` flags.
 */
import { parseArgs } from "node:util";
import type { Pool } from "pg";
import * as z from "zod";

const count = z.number().int().nonnegative();
/** Largest value a Postgres `integer` column holds. */
const INT32_MAX = 2_147_483_647;
const text = z.string().trim().min(1);

const agentRunSchema = z.object({
  /** GitHub issue number the run worked on. */
  issueId: z.number().int().positive().max(INT32_MAX),
  /** Workflow name, e.g. `wf-dev`. */
  workflowId: text,
  /** Script reference: path and/or version of the workflow script. */
  workflowReference: text,
  /** Workflow run id, e.g. `wf_c2d1ad6a-1bc`. */
  workflowInstance: text,
  /** When the workflow run started. */
  workflowDate: z.date().refine((d) => !Number.isNaN(d.getTime()), "invalid date"),
  /** The agent's role/label, e.g. `wf-dev/#3/qa-r1`. */
  agent: text,
  /** Model id used by the agent. */
  model: text,
  /** Reasoning effort level: low, medium, high, … */
  effort: text,
  /** Duration of the agent run, in milliseconds. */
  timeUsedMs: count,
  /** Verification/fix round; 0 is the first pass. */
  roundNumber: count.max(INT32_MAX),
  /** Total tokens consumed by the agent. */
  tokensUsed: count,
});

export type AgentRun = z.infer<typeof agentRunSchema>;
export type RecordedAgentRun = AgentRun & { id: number; createdAt: Date };

/** Creates or upgrades the Agent Run log table. Safe to run repeatedly. */
export async function migrateAgentRunLog(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS workflow_agent_run (
      id                 bigserial   PRIMARY KEY,
      issue_id           integer     NOT NULL,
      created_at         timestamptz NOT NULL DEFAULT now(),
      workflow_id        text        NOT NULL,
      workflow_reference text        NOT NULL,
      workflow_instance  text        NOT NULL,
      workflow_date      timestamptz NOT NULL,
      agent              text        NOT NULL,
      model              text        NOT NULL,
      effort             text        NOT NULL,
      time_used_ms       bigint      NOT NULL CHECK (time_used_ms >= 0),
      round_number       integer     NOT NULL DEFAULT 0 CHECK (round_number >= 0),
      tokens_used        bigint      NOT NULL CHECK (tokens_used >= 0)
    );
    CREATE INDEX IF NOT EXISTS workflow_agent_run_issue_id_idx ON workflow_agent_run (issue_id);
    CREATE INDEX IF NOT EXISTS workflow_agent_run_workflow_instance_idx ON workflow_agent_run (workflow_instance);
  `);
}

/** Validates one Agent Run and inserts it; returns the stored row. */
export async function recordAgentRun(database: Pool, run: AgentRun): Promise<RecordedAgentRun> {
  const parsed = agentRunSchema.safeParse(run);
  if (!parsed.success) throw new Error(`Invalid Agent Run: ${z.prettifyError(parsed.error)}`);
  const r = parsed.data;
  const { rows } = await database.query(
    `INSERT INTO workflow_agent_run
       (issue_id, workflow_id, workflow_reference, workflow_instance, workflow_date,
        agent, model, effort, time_used_ms, round_number, tokens_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, created_at`,
    [
      r.issueId, r.workflowId, r.workflowReference, r.workflowInstance, r.workflowDate,
      r.agent, r.model, r.effort, r.timeUsedMs, r.roundNumber, r.tokensUsed,
    ],
  );
  return { ...r, id: Number(rows[0].id), createdAt: rows[0].created_at };
}

/** `npm run wf:record` flag → Agent Run field. */
const flags = {
  issue: "issueId",
  "workflow-id": "workflowId",
  "workflow-ref": "workflowReference",
  "workflow-instance": "workflowInstance",
  "workflow-date": "workflowDate",
  agent: "agent",
  model: "model",
  effort: "effort",
  "time-ms": "timeUsedMs",
  round: "roundNumber",
  tokens: "tokensUsed",
} as const satisfies Record<string, keyof AgentRun>;

/** Usage line for the `wf:record` command. */
export const AGENT_RUN_USAGE = `npm run wf:record -- ${Object.keys(flags)
  .map((flag) => (flag === "round" ? `[--${flag} <n>]` : `--${flag} <value>`))
  .join(" ")}`;

/**
 * Reads a `--workflow-date`: an ISO 8601 calendar date (`2026-10-06`, taken as
 * UTC midnight) or date-time with an explicit offset (`…T08:00:00Z`,
 * `…T10:00:00+02:00`). Anything else, including dates that do not exist
 * (`2026-02-30`) or times without an offset (read in the machine's local
 * time), gives an invalid date rather than a silently shifted one.
 */
function parseWorkflowDate(raw: string): Date {
  const value = raw.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) return new Date(Number.NaN);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map((part) => Number(part ?? 0));
  const fields = new Date(Date.UTC(year!, month! - 1, day!, hour, minute, second));
  const exists =
    fields.getUTCFullYear() === year &&
    fields.getUTCMonth() === month! - 1 &&
    fields.getUTCDate() === day &&
    fields.getUTCHours() === hour &&
    fields.getUTCMinutes() === minute &&
    fields.getUTCSeconds() === second;
  return exists ? new Date(match[4] === undefined ? `${value}T00:00:00Z` : value) : new Date(Number.NaN);
}

/**
 * Reads an Agent Run from command-line flags (`--issue 31` or `--issue=31`).
 * `--round` defaults to 0. Throws naming every missing or invalid flag.
 */
export function agentRunFromArgs(argv: string[]): AgentRun {
  let values: Record<string, string | undefined>;
  try {
    values = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: Object.fromEntries(Object.keys(flags).map((flag) => [flag, { type: "string" as const }])),
    }).values as Record<string, string | undefined>;
  } catch (error) {
    throw new Error(`${(error as Error).message}\nUsage: ${AGENT_RUN_USAGE}`);
  }

  const missing = Object.keys(flags).filter((flag) => flag !== "round" && values[flag] === undefined);
  if (missing.length) {
    throw new Error(`Missing ${missing.map((f) => `--${f}`).join(", ")}\nUsage: ${AGENT_RUN_USAGE}`);
  }

  const numeric = (flag: string): number => {
    const raw = values[flag]!;
    return /^\d+$/.test(raw.trim()) ? Number(raw) : Number.NaN;
  };
  const run = {
    issueId: numeric("issue"),
    workflowId: values["workflow-id"],
    workflowReference: values["workflow-ref"],
    workflowInstance: values["workflow-instance"],
    workflowDate: parseWorkflowDate(values["workflow-date"]!),
    agent: values.agent,
    model: values.model,
    effort: values.effort,
    timeUsedMs: numeric("time-ms"),
    roundNumber: values.round === undefined ? 0 : numeric("round"),
    tokensUsed: numeric("tokens"),
  };

  const parsed = agentRunSchema.safeParse(run);
  if (!parsed.success) {
    const fieldToFlag = Object.fromEntries(Object.entries(flags).map(([flag, field]) => [field, flag]));
    const bad = [...new Set(parsed.error.issues.map((issue) => `--${fieldToFlag[String(issue.path[0])]}`))];
    throw new Error(`Invalid ${bad.join(", ")}\nUsage: ${AGENT_RUN_USAGE}`);
  }
  return parsed.data;
}
