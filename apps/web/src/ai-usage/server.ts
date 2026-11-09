import { allUsageLogs, createConsoleUsageLog, type UsageLog } from "@jobhub/ai";
import { getBackOffice } from "@/admin/server";
import { sharedPool } from "@/database/pool";
import { getSecretResolver } from "@/provider-secrets/server";
import { aiUsagePeriod, aiUsageReport, knownSecrets, type AiUsageFilter, type AiUsageReport } from "./index";
import { createAiMessageLogs, type AiMessageLogs } from "./message-log";
import { webPostgresUsageLog } from "./web-usage-log";

let usage: UsageLog | undefined;
let messageLogs: AiMessageLogs | undefined;

/**
 * Where the app's AI layer records each call: a JSON line on stdout (CloudWatch) and, with a
 * database, AI Usage and the AI Message Log, every key in use scrubbed from what calls said, each call with the Surface
 * of the request it was made for (#919).
 */
export function getAiUsageLog(): UsageLog {
  usage ??= process.env.DATABASE_URL
    ? allUsageLogs([createConsoleUsageLog(), webPostgresUsageLog(sharedPool(), { secrets: () => knownSecrets(getSecretResolver().current().env) })])
    : createConsoleUsageLog();
  return usage;
}

export { getExternalApiLog } from "./external-api-log";

/** The AI consumption of the period `key` names (the last 30 days by default), as the Back Office's report shows it; its AI calls from one Surface with `filter`. */
export function aiUsageReportOf(key: unknown, filter: AiUsageFilter = {}): Promise<AiUsageReport> {
  return aiUsageReport(sharedPool(), aiUsagePeriod(key, new Date()), filter);
}

/** The AI Message Log, as super-admins read it on the Journaux IA page; every view goes to the Back Office Audit. */
export function getAiMessageLogs(): AiMessageLogs {
  messageLogs ??= createAiMessageLogs(sharedPool(), { backOffice: getBackOffice() });
  return messageLogs;
}
