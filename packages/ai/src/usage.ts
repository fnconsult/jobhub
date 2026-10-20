import type { UsageLog } from "./types";

/**
 * Writes one JSON line per AI call to stdout (collected by CloudWatch in production).
 * Each line carries the Candidate and token counts, which Plan Quotas are computed from.
 * Never what the call said (its transcript) nor its technical Failure Reason: personal data, kept only by the AI Message Log.
 */
export function createConsoleUsageLog(write: (line: string) => void = (line) => console.info(line)): UsageLog {
  return {
    record(entry) {
      write(JSON.stringify({ event: "ai_usage", ...entry, transcript: undefined, technicalReason: undefined, at: entry.at.toISOString() }));
    },
  };
}

/**
 * One usage log handing each call to all of `logs`; one that throws or rejects does not keep
 * the others from it, and is only warned about. Resolves once each has settled.
 */
export function allUsageLogs(
  logs: readonly UsageLog[],
  warn: (message: string, error: unknown) => void = (message, error) => console.warn(`[ai] ${message}`, error instanceof Error ? error.message : error),
): UsageLog {
  return {
    async record(entry) {
      await Promise.all(
        logs.map(async (log) => {
          try {
            await log.record(entry);
          } catch (error) {
            warn("AI usage not recorded", error);
          }
        }),
      );
    },
  };
}
