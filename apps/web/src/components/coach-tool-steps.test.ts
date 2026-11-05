import type { Provenance, ProvenanceStep, StartedStep } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { consultedElements, liveLines, namesByPage, NO_STEP_YET, stepEnded, stepStarted, type LiveReply } from "./coach-tool-steps";

const AT = "2026-11-05T10:00:00.000Z";
const read: StartedStep = { kind: "tool", activity: "act", tool: "applications", at: AT };
const propose: StartedStep = { kind: "tool", activity: "act", tool: "applications", proposes: true, at: AT };
const check: StartedStep = { kind: "ai", activity: "think", task: "guardrail", at: AT };
const write: StartedStep = { kind: "ai", activity: "think_write", task: "coaching", at: AT };
const ended = (step: StartedStep): ProvenanceStep => ({ ...step, ms: 10, outcome: "ok", count: 1 }) as ProvenanceStep;

/** Plays a reply's step events in order. */
function play(events: ({ started: [number, StartedStep, string] } | { ended: [number, ProvenanceStep] })[]): LiveReply {
  return events.reduce<LiveReply>(
    (live, event) =>
      "started" in event
        ? stepStarted(live, { id: event.started[0], step: event.started[1], label: event.started[2] as never })
        : stepEnded(live, { id: event.ended[0], step: event.ended[1] }),
    NO_STEP_YET,
  );
}

describe("a reply's steps live (#788): one line per Coach Action, the step under way last", () => {
  it("a Guardrail check after a read never takes the read's line away", () => {
    const live = play([
      { started: [1, read, "act"] },
      { ended: [1, ended(read)] },
      { started: [2, check, "check"] },
    ]);

    const { lines, current } = liveLines(live);
    expect(lines.map((line) => [line.label, line.ended])).toEqual([
      ["act", true],
      ["check", false],
    ]);
    expect(current?.id).toBe(2);
  });

  it("each Coach Action keeps its own line to the end; the check is gone once the reply is being written, which comes last", () => {
    const live = play([
      { started: [1, read, "act"] },
      { ended: [1, ended(read)] },
      { started: [2, check, "check"] },
      { ended: [2, ended(check)] },
      { started: [3, read, "act"] },
      { ended: [3, ended(read)] },
      { started: [4, propose, "propose"] },
      { ended: [4, ended(propose)] },
      { started: [5, write, "think_write"] },
    ]);

    const { lines, current } = liveLines(live);
    expect(lines.map((line) => [line.id, line.label, line.tool, line.ended])).toEqual([
      [1, "act", "applications", true],
      [3, "act", "applications", true],
      [4, "propose", "applications", true],
      [5, "think_write", null, false],
    ]);
    expect(current).toMatchObject({ id: 5, activity: "think_write" });
  });

  it("the reply being written spans its Coach Actions (one AI step around them): once they end, it is the step under way, last", () => {
    const live = play([
      { started: [1, write, "think_write"] },
      { started: [2, read, "act"] },
      { ended: [2, ended(read)] },
      { started: [3, check, "check"] },
    ]);
    expect(liveLines(live).lines.map((line) => line.label)).toEqual(["act", "check"]);
    expect(liveLines(live).current?.id).toBe(3);

    const after = play([
      { started: [1, write, "think_write"] },
      { started: [2, read, "act"] },
      { ended: [2, ended(read)] },
      { started: [3, check, "check"] },
      { ended: [3, ended(check)] },
      { started: [4, read, "act"] },
      { ended: [4, ended(read)] },
    ]);
    expect(liveLines(after).lines.map((line) => [line.id, line.label, line.ended])).toEqual([
      [2, "act", true],
      [4, "act", true],
      [1, "think_write", false],
    ]);
    expect(liveLines(after).current).toMatchObject({ id: 1, activity: "think_write" });
  });

  it("a Coach Action under way is the last line, and the glyph's step", () => {
    const live = play([{ started: [1, check, "check"] }, { ended: [1, ended(check)] }, { started: [2, read, "act"] }]);

    expect(liveLines(live).lines.map((line) => line.id)).toEqual([2]);
    expect(liveLines(live).current).toMatchObject({ id: 2, activity: "act", label: "act", ended: false });
  });

  it("every step makes a new object, which the thread's scrolling follows", () => {
    const started = stepStarted(NO_STEP_YET, { id: 1, step: write, label: "think_write" });
    const done = stepEnded(started, { id: 1, step: ended(write) });

    expect(started).not.toBe(NO_STEP_YET);
    expect(done).not.toBe(started);
    expect(NO_STEP_YET.steps).toEqual([]);
  });

  it("nothing started yet: no line, no glyph", () => {
    expect(liveLines(NO_STEP_YET)).toEqual({ lines: [], current: null });
  });
});

const provenance = (steps: ProvenanceStep[], links: string[]): Provenance => ({
  v: 1,
  steps,
  sites: links.length > 0 ? [{ kind: "candidate", links }] : [],
  startedAt: AT,
  wallMs: 100,
});

describe("what a Coach Action saw, live (#788)", () => {
  it("names each object from its step's end, keeps a list's count, and gives the names by page for the reply", () => {
    const started = stepStarted(NO_STEP_YET, { id: 1, step: { ...read, action: "read_application" }, label: "act" });
    expect(started.steps[0]).toMatchObject({ action: "read_application", seen: [], ended: false });
    const end = {
      id: 1,
      step: { ...ended(read), action: "read_application", seen: [{ type: "application" as const, href: "/candidatures/a1" }, { type: "all" as const, count: 3 }] },
      names: ["Airbus · Contrôleuse de gestion", null],
    };
    expect(stepEnded(started, end).steps[0]).toMatchObject({
      ended: true,
      seen: [{ type: "application", href: "/candidatures/a1", name: "Airbus · Contrôleuse de gestion" }, { type: "all", count: 3 }],
    });
    expect(namesByPage(end)).toEqual({ "/candidatures/a1": "Airbus · Contrôleuse de gestion" });
    expect(namesByPage({ step: ended(write) })).toEqual({});
  });
});

describe("what the AI Coach consulted in Jobbbox, from the stored Provenance (#788)", () => {
  it("each object a Coach Action saw, once, by its name now, linked to its page; a list by its count", () => {
    const listed = { ...ended(read), action: "list_objects", seen: [{ type: "application" as const, count: 12 }] };
    const opened = { ...ended(read), action: "read_application", count: 2, seen: [{ type: "application" as const, href: "/candidatures/a1" }] };
    const proposed = { ...ended(propose), action: "propose_application_status", seen: [{ type: "application" as const, href: "/candidatures/a1" }, { type: "profile" as const, href: "/profils/p1" }] };
    const consulted = consultedElements(provenance([ended(write), listed, opened, proposed], ["/candidatures/a1"]), { "/candidatures/a1": "Airbus · Contrôleuse de gestion" });

    expect(consulted).toEqual([
      { kind: "count", type: "application", count: 12 },
      { kind: "object", href: "/candidatures/a1", page: "application", name: "Airbus · Contrôleuse de gestion", type: "application" },
      // No name known for it (an object since deleted, or another Candidate's): its kind of page.
      { kind: "object", href: "/profils/p1", page: "profile", name: null, type: "profile" },
    ]);
  });

  it("for a Provenance kept before Coach Actions said what they saw: each page of the Candidate read or proposed on, linked, by its kind", () => {
    const consulted = consultedElements(
      provenance([ended(write), { ...ended(read), count: 2 }, ended(propose)], ["/candidatures/a1", "/profils/p1", "/candidatures", "/recherches/s1/offres/o1", "/job-digests/d1"]),
    );

    expect(consulted).toEqual([
      { kind: "page", href: "/candidatures/a1", page: "application" },
      { kind: "page", href: "/profils/p1", page: "profile" },
      { kind: "page", href: "/candidatures", page: "applications" },
      { kind: "page", href: "/recherches/s1/offres/o1", page: "job_offer" },
      { kind: "page", href: "/job-digests/d1", page: "job_digest" },
    ]);
  });

  it("a Coach Action with no page (the Agenda): its Tool, unlinked", () => {
    expect(consultedElements(provenance([ended(write), ended({ ...read, tool: "agenda" })], []))).toEqual([{ kind: "tool", tool: "agenda" }]);
  });

  it("nothing for a reply without a Coach Action, or with no Provenance", () => {
    expect(consultedElements(provenance([ended(write)], []))).toEqual([]);
    expect(consultedElements(null)).toEqual([]);
  });
});
