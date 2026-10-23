import { describe, expect, it } from "vitest";
import type { ProvenanceEvent, ProvenanceStep } from "./provenance";
import { createRunProgress, MAX_PROGRESS_EVENTS, readRunProgress } from "./run-progress";

const started = (id: number): ProvenanceEvent => ({ type: "step_started", id, step: { kind: "tool", activity: "search", tool: "france-travail", at: "2026-10-23T10:00:00.000Z" } });
const endedStep: ProvenanceStep = { kind: "tool", activity: "search", tool: "france-travail", ms: 640, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1 };
const ended = (id: number): ProvenanceEvent => ({ type: "step_ended", id, step: endedStep });
const aiEnded = (id: number): ProvenanceEvent => ({
  type: "step_ended",
  id,
  step: { kind: "ai", activity: "think", task: "job_titles", provider: "anthropic", endpoint: "bedrock eu-north-1", model: "anthropic.claude-opus-5", tokens: { input: 900, output: 40 }, ms: 1200, at: "2026-10-23T10:00:01.000Z", outcome: "ok", count: 1 },
});

/** A write the test lets finish when it wants. */
function heldWrites() {
  const written: ProvenanceEvent[][] = [];
  const pending: (() => void)[] = [];
  return {
    written,
    write: (events: ProvenanceEvent[]) =>
      new Promise<void>((resolve) => {
        written.push(events);
        pending.push(resolve);
      }),
    finishOne: async () => {
      pending.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("a run's progress, written on its row as its steps start and end (#330)", () => {
  it("writes each step as it starts, then as it ended in place of its start", async () => {
    const written: ProvenanceEvent[][] = [];
    const progress = createRunProgress(async (events) => void written.push(events));

    progress.onEvent(started(1));
    await progress.flush();
    progress.onEvent(ended(1));
    progress.onEvent(started(2));
    await progress.flush();

    expect(written.at(0)).toEqual([started(1)]);
    expect(written.at(-1)).toEqual([ended(1), started(2)]);
  });

  it("writes once more, with the latest steps, what came while a write was on its way: never two writes at once", async () => {
    const writes = heldWrites();
    const progress = createRunProgress(writes.write);

    progress.onEvent(started(1));
    progress.onEvent(ended(1));
    progress.onEvent(started(2));
    expect(writes.written).toEqual([[started(1)]]);

    await writes.finishOne();
    expect(writes.written).toEqual([[started(1)], [ended(1), started(2)]]);
    await writes.finishOne();
    await progress.flush();
    expect(writes.written).toHaveLength(2);
  });

  it("goes on when a write fails: the run never stops for its progress", async () => {
    let fail = true;
    const written: ProvenanceEvent[][] = [];
    const progress = createRunProgress(async (events) => {
      if (fail) throw new Error("database down");
      written.push(events);
    });

    progress.onEvent(started(1));
    await progress.flush();
    fail = false;
    progress.onEvent(ended(1));
    await progress.flush();

    expect(written).toEqual([[ended(1)]]);
  });

  it(`keeps the steps running and the latest ended ones, at most ${MAX_PROGRESS_EVENTS}`, async () => {
    const written: ProvenanceEvent[][] = [];
    const progress = createRunProgress(async (events) => void written.push(events));

    progress.onEvent(started(1));
    for (let id = 2; id <= MAX_PROGRESS_EVENTS + 10; id++) progress.onEvent(ended(id));
    await progress.flush();

    const last = written.at(-1)!;
    expect(last).toHaveLength(MAX_PROGRESS_EVENTS);
    expect(last[0]).toEqual(started(1));
    expect(last.at(-1)).toEqual(ended(MAX_PROGRESS_EVENTS + 10));
  });
});

describe("a run's progress read from its row (#330)", () => {
  it("is the events written", () => {
    const events = [ended(1), aiEnded(2), started(3)];
    expect(readRunProgress(JSON.parse(JSON.stringify(events)))).toEqual(events);
  });

  it("is none when nothing was written, and leaves out what is not a step's event", () => {
    expect(readRunProgress(null)).toEqual([]);
    expect(readRunProgress({ events: [] })).toEqual([]);
    const namingSomeone = { ...ended(2), step: { ...endedStep, candidateId: "4b1c2d3e-0000-4000-8000-000000000000" } };
    expect(readRunProgress([ended(1), namingSomeone, { type: "done" }, "text"])).toEqual([ended(1)]);
  });
});
