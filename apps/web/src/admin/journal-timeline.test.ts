import { toolById } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { LinkedMailboxEvent } from "../email-intake/activity";
import type { CalledTool } from "../tools";
import type { BackOfficeAuditEntry } from "./back-office";
import { journalTimeline } from "./journal-timeline";

const entry = (id: string, at: string): BackOfficeAuditEntry => ({
  id,
  at: new Date(at),
  actor: { candidateId: "c-1", email: "admin@jobbbox.ai" },
  section: "plans",
  target: "standard",
  action: "updated",
  before: { name: "Standard" },
  after: { name: "Standard+" },
  outcome: "succeeded",
  failure: null,
});
const call = (toolId: string, at: string, ok = true): CalledTool => ({
  tool: toolById(toolId)!,
  call: { at: new Date(at), operation: "checkout.sessions.create", ok, outcome: ok ? "ok" : "failed", reason: null, httpStatus: ok ? 200 : 500, durationMs: 300, costEur: null },
});

describe("the Journal with its Outils filter: the Back Office changes and the tool calls, together", () => {
  it("puts them in one list, newest first, each as what it is", () => {
    const timeline = journalTimeline(
      [entry("e-2", "2026-10-20T10:00:00Z"), entry("e-1", "2026-10-20T08:00:00Z")],
      { toolCalls: [call("stripe", "2026-10-20T11:00:00Z"), call("brevo-api", "2026-10-20T09:00:00Z")] },
      10,
    );

    expect(timeline.map((line) => (line.kind === "change" ? `change ${line.entry.id}` : line.kind === "tool_call" ? `call ${line.tool.id}` : line.kind))).toEqual(["call stripe", "change e-2", "call brevo-api", "change e-1"]);
    expect(timeline.map((line) => line.at.toISOString())).toEqual(["2026-10-20T11:00:00.000Z", "2026-10-20T10:00:00.000Z", "2026-10-20T09:00:00.000Z", "2026-10-20T08:00:00.000Z"]);
  });

  it("keeps the most recent ones, at most the number asked", () => {
    const timeline = journalTimeline([entry("e-1", "2026-10-20T08:00:00Z")], { toolCalls: [call("stripe", "2026-10-20T11:00:00Z"), call("stripe", "2026-10-20T09:00:00Z")] }, 2);

    expect(timeline.map((line) => line.at.toISOString())).toEqual(["2026-10-20T11:00:00.000Z", "2026-10-20T09:00:00.000Z"]);
  });

  it("puts a change before a call made at the same time", () => {
    const timeline = journalTimeline([entry("e-1", "2026-10-20T08:00:00Z")], { toolCalls: [call("stripe", "2026-10-20T08:00:00Z")] }, 10);

    expect(timeline.map((line) => line.kind)).toEqual(["change", "tool_call"]);
  });

  it("keeps, under a Résultat, only the tool calls with that outcome (#263)", () => {
    const calls = [call("stripe", "2026-10-20T11:00:00Z", false), call("brevo-api", "2026-10-20T09:00:00Z")];
    const callsOf = (outcome: "succeeded" | "failed" | undefined) =>
      journalTimeline([], { toolCalls: calls }, 10, outcome).map((line) => (line.kind === "tool_call" ? `${line.tool.id} ${line.call.ok}` : "change"));

    expect(callsOf("failed")).toEqual(["stripe false"]);
    expect(callsOf("succeeded")).toEqual(["brevo-api true"]);
    expect(callsOf(undefined)).toEqual(["stripe false", "brevo-api true"]);
  });
});

describe("the Journal with its Boîtes reliées filter (#449): the Back Office changes and the Linked mailbox events, together", () => {
  const event = (id: string, at: string, kind: LinkedMailboxEvent["event"]): LinkedMailboxEvent => ({ id, at: new Date(at), event: kind });

  it("puts them in one list, newest first, a change before an event at the same time", () => {
    const timeline = journalTimeline(
      [entry("e-1", "2026-10-20T10:00:00Z")],
      { linkedMailboxEvents: [event("l-2", "2026-10-20T11:00:00Z", "daily_cap_reached"), event("l-1", "2026-10-20T10:00:00Z", "switched_on")] },
      10,
    );

    expect(timeline.map((line) => (line.kind === "linked_mailbox" ? `${line.event.event} ${line.event.id}` : line.kind))).toEqual(["daily_cap_reached l-2", "change", "switched_on l-1"]);
  });

  it("counts every event as succeeded under a Résultat: none failed", () => {
    const events = { linkedMailboxEvents: [event("l-1", "2026-10-20T10:00:00Z", "switched_off")] };

    expect(journalTimeline([], events, 10, "succeeded")).toHaveLength(1);
    expect(journalTimeline([], events, 10, "failed")).toEqual([]);
  });
});
