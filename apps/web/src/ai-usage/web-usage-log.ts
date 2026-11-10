import type { UsageLog } from "@jobhub/ai";
import type { Pool } from "pg";
import { currentRequestSurface } from "../request-surface/server";
import { createPostgresUsageLog, type PostgresAiUsageLogOptions } from "./index";

/** The web app's AI Usage and AI Message Log on Postgres: each call with the Surface of the request it was made for (#919). */
export function webPostgresUsageLog(database: Pick<Pool, "query">, options: Omit<PostgresAiUsageLogOptions, "surface"> = {}): UsageLog {
  return createPostgresUsageLog(database, { ...options, surface: currentRequestSurface });
}
