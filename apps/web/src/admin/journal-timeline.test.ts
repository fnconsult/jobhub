import { toolById } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
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
});
const call = (toolId: string, at: string): CalledTool => ({
  tool: toolById(toolId)!,
  call: { at: new Date(at), operation: "checkout.sessions.create", ok: true, httpStatus: 200, durationMs: 300, costEur: null },
});

describe("the Journal with its Outils filter: the Back Office changes and the tool calls, together", () => {
  it("puts them in one list, newest first, each as what it is", () => {
    const timeline = journalTimeline(
      [entry("e-2", "2026-10-20T10:00:00Z"), entry("e-1", "2026-10-20T08:00:00Z")],
      [call("stripe", "2026-10-20T11:00:00Z"), call("brevo-api", "2026-10-20T09:00:00Z")],
      10,
    );

    expect(timeline.map((line) => (line.kind === "change" ? `change ${line.entry.id}` : `call ${line.tool.id}`))).toEqual(["call stripe", "change e-2", "call brevo-api", "change e-1"]);
    expect(timeline.map((line) => line.at.toISOString())).toEqual(["2026-10-20T11:00:00.000Z", "2026-10-20T10:00:00.000Z", "2026-10-20T09:00:00.000Z", "2026-10-20T08:00:00.000Z"]);
  });

  it("keeps the most recent ones, at most the number asked", () => {
    const timeline = journalTimeline([entry("e-1", "2026-10-20T08:00:00Z")], [call("stripe", "2026-10-20T11:00:00Z"), call("stripe", "2026-10-20T09:00:00Z")], 2);

    expect(timeline.map((line) => line.at.toISOString())).toEqual(["2026-10-20T11:00:00.000Z", "2026-10-20T09:00:00.000Z"]);
  });

  it("puts a change before a call made at the same time", () => {
    const timeline = journalTimeline([entry("e-1", "2026-10-20T08:00:00Z")], [call("stripe", "2026-10-20T08:00:00Z")], 10);

    expect(timeline.map((line) => line.kind)).toEqual(["change", "tool_call"]);
  });
});
