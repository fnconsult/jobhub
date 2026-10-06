import type { UsageLog } from "./types";

/**
 * Writes one JSON line per AI call to stdout (collected by CloudWatch in production).
 * Each line carries the Candidate and token counts, which Plan Quotas are computed from.
 */
export function createConsoleUsageLog(write: (line: string) => void = (line) => console.info(line)): UsageLog {
  return {
    record(entry) {
      write(JSON.stringify({ event: "ai_usage", ...entry, at: entry.at.toISOString() }));
    },
  };
}
