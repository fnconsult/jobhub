import type { UsageLog } from "@jobhub/ai";
import { createPostgresUsageLog, type PostgresAiUsageLogOptions } from "@jobhub/web/ai-usage";
import type { Pool } from "pg";

/** The worker's AI Usage and AI Message Log on Postgres: every call it makes is asked from the `worker` Surface (#919). */
export function workerPostgresUsageLog(database: Pick<Pool, "query">, options: Omit<PostgresAiUsageLogOptions, "surface"> = {}): UsageLog {
  return createPostgresUsageLog(database, { ...options, surface: () => "worker" });
}
