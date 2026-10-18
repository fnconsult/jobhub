import { allUsageLogs, createConsoleUsageLog, type UsageLog } from "@jobhub/ai";
import type { ExternalApiLog } from "@jobhub/shared";
import { getBackOffice } from "@/admin/server";
import { sharedPool } from "@/database/pool";
import { getSecretResolver } from "@/provider-secrets/server";
import { aiUsagePeriod, aiUsageReport, createPostgresExternalApiLog, createPostgresUsageLog, knownSecrets, type AiUsageReport } from "./index";
import { createAiMessageLogs, type AiMessageLogs } from "./message-log";

let usage: UsageLog | undefined;
let externalApis: ExternalApiLog | undefined;
let messageLogs: AiMessageLogs | undefined;

/**
 * Where the app's AI layer records each call: a JSON line on stdout (CloudWatch) and, with a
 * database, AI Usage and the AI Message Log, every key in use scrubbed from what calls said.
 */
export function getAiUsageLog(): UsageLog {
  usage ??= process.env.DATABASE_URL
    ? allUsageLogs([createConsoleUsageLog(), createPostgresUsageLog(sharedPool(), { secrets: () => knownSecrets(getSecretResolver().current().env) })])
    : createConsoleUsageLog();
  return usage;
}

/** Where the app's calls to external APIs (contact enrichment) are recorded; none without a database. */
export function getExternalApiLog(): ExternalApiLog {
  externalApis ??= process.env.DATABASE_URL ? createPostgresExternalApiLog(sharedPool()) : { record: () => {} };
  return externalApis;
}

/** The AI consumption of the period `key` names (the last 30 days by default), as the Back Office's report shows it. */
export function aiUsageReportOf(key: unknown): Promise<AiUsageReport> {
  return aiUsageReport(sharedPool(), aiUsagePeriod(key, new Date()));
}

/** The AI Message Log, as super-admins read it on the Journaux IA page; every view goes to the Back Office Audit. */
export function getAiMessageLogs(): AiMessageLogs {
  messageLogs ??= createAiMessageLogs(sharedPool(), { backOffice: getBackOffice() });
  return messageLogs;
}
