import type { Tool } from "@jobhub/shared";
import type { CalledTool, ToolCall } from "../tools";
import type { BackOfficeAuditEntry, BackOfficeOutcome } from "./back-office";

/** One line of the Journal with its Outils filter (#234): a Back Office change, or a call to a Tool. */
export type JournalLine = { kind: "change"; at: Date; entry: BackOfficeAuditEntry } | { kind: "tool_call"; at: Date; tool: Tool; call: ToolCall };

/** Whether a tool call has the Résultat `outcome` (#263): a call that went through succeeded. */
export const toolCallOk = (outcome: BackOfficeOutcome): boolean => outcome === "succeeded";

/**
 * The Back Office Audit's `entries` and the Tools' `calls` in one list, newest first (a change
 * before a call made at the same time): the `limit` most recent. Under a Résultat (`outcome`),
 * only the changes and calls with that outcome (#263). Both stay where they are recorded (the Back
 * Office Audit, AI Usage): this only lists them side by side.
 */
export function journalTimeline(entries: readonly BackOfficeAuditEntry[], calls: readonly CalledTool[], limit: number, outcome?: BackOfficeOutcome): JournalLine[] {
  const shownEntries = outcome ? entries.filter((entry) => entry.outcome === outcome) : entries;
  const shownCalls = outcome ? calls.filter(({ call }) => call.ok === toolCallOk(outcome)) : calls;
  const lines: JournalLine[] = [
    ...shownEntries.map((entry): JournalLine => ({ kind: "change", at: entry.at, entry })),
    ...shownCalls.map(({ tool, call }): JournalLine => ({ kind: "tool_call", at: call.at, tool, call })),
  ];
  // A stable sort: each list's own order (newest first) holds at the same time, changes before calls.
  return lines.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
