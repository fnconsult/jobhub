import type { Tool } from "@jobhub/shared";
import type { LinkedMailboxEvent } from "../email-intake/activity";
import type { CalledTool, ToolCall } from "../tools";
import type { BackOfficeAuditEntry, BackOfficeOutcome } from "./back-office";

/**
 * One line of the Journal: a Back Office change; with its Outils filter (#234), a call to a Tool; with its Boîtes
 * reliées filter (#449), a Linked mailbox event.
 */
export type JournalLine =
  | { kind: "change"; at: Date; entry: BackOfficeAuditEntry }
  | { kind: "tool_call"; at: Date; tool: Tool; call: ToolCall }
  | { kind: "linked_mailbox"; at: Date; event: LinkedMailboxEvent };

/** What the Journal lists beside the Back Office changes: the Tools' calls (Outils), the Linked mailbox events (Boîtes reliées). */
export interface JournalBeside {
  toolCalls?: readonly CalledTool[];
  linkedMailboxEvents?: readonly LinkedMailboxEvent[];
}

/** Whether a tool call has the Résultat `outcome` (#263): a call that went through succeeded. */
export const toolCallOk = (outcome: BackOfficeOutcome): boolean => outcome === "succeeded";

/**
 * The Back Office Audit's `entries` and what is listed `beside` them in one list, newest first (at the same time: a
 * change, then a call, then a Linked mailbox event): the `limit` most recent. Under a Résultat (`outcome`), only the
 * changes and calls with that outcome (#263); a Linked mailbox event counts as succeeded. Each stays where it is
 * recorded (the Back Office Audit, AI Usage, Email intake's own table): this only lists them side by side.
 */
export function journalTimeline(entries: readonly BackOfficeAuditEntry[], beside: JournalBeside, limit: number, outcome?: BackOfficeOutcome): JournalLine[] {
  const { toolCalls = [], linkedMailboxEvents = [] } = beside;
  const shownEntries = outcome ? entries.filter((entry) => entry.outcome === outcome) : entries;
  const shownCalls = outcome ? toolCalls.filter(({ call }) => call.ok === toolCallOk(outcome)) : toolCalls;
  const shownEvents = outcome === "failed" ? [] : linkedMailboxEvents;
  const lines: JournalLine[] = [
    ...shownEntries.map((entry): JournalLine => ({ kind: "change", at: entry.at, entry })),
    ...shownCalls.map(({ tool, call }): JournalLine => ({ kind: "tool_call", at: call.at, tool, call })),
    ...shownEvents.map((event): JournalLine => ({ kind: "linked_mailbox", at: event.at, event })),
  ];
  // A stable sort: each list's own order (newest first) holds at the same time, changes before calls before events.
  return lines.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
