import type { ProvenanceEvent } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { enCeMoment, glyphNow } from "./en-ce-moment";
import { nextLive, type LiveAction, type LiveChange } from "./live";

const at = "2026-11-06T10:00:00.000Z";
const later = (seconds: number) => new Date(Date.parse(at) + seconds * 1000).toISOString();
const NOW = Date.parse(later(12));

const apply = (...changes: LiveChange[]): LiveAction[] => changes.reduce<LiveAction[]>((actions, change) => nextLive(actions, change), []);
const step = (key: string, event: ProvenanceEvent): LiveChange => ({ type: "step", key, event });

const searchPage = "/recherches/s1";
const searchStarted: LiveChange = { type: "started", key: "job_search:s1", kind: "job_search", href: searchPage, at };
const replyStarted: LiveChange = { type: "started", key: "coach_reply:1", kind: "coach_reply", href: searchPage, at: later(4) };
const webSearch = step("job_search:s1", { type: "step_started", id: 1, step: { kind: "ai", activity: "web_search", task: "web_search", at } });
const webSearchEnded = step("job_search:s1", {
  type: "step_ended",
  id: 1,
  step: { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", model: "sonar", tokens: { input: 10, output: 20 }, ms: 2000, at, outcome: "ok", count: 3 },
});
const reading = step("job_search:s1", { type: "step_started", id: 2, step: { kind: "tool", activity: "read", tool: "job-site", at: later(2) } });
// A Coach Action read (#788), the Guardrail's check after it, then the reply being written.
const consults = step("coach_reply:1", { type: "step_started", id: 1, step: { kind: "tool", activity: "act", tool: "job-site", at: later(4) } });
const consulted = step("coach_reply:1", { type: "step_ended", id: 1, step: { kind: "tool", activity: "act", tool: "job-site", ms: 40, at: later(4), outcome: "ok", count: 1 } });
const checks = step("coach_reply:1", { type: "step_started", id: 2, step: { kind: "ai", activity: "think", task: "guardrail", at: later(5) } });
const proposes = step("coach_reply:1", { type: "step_started", id: 3, step: { kind: "tool", activity: "act", tool: "job-site", proposes: true, at: later(6) } });

describe("« En ce moment » (ADR-0086, #806)", () => {
  it("is empty with nothing running: « Rien ne tourne sur cette page. »", () => {
    expect(enCeMoment([], searchPage, NOW)).toEqual({ here: [], elsewhere: [] });
  });

  it("holds a Job Search and a Coach reply asked meanwhile on the same page, each with its own step under way, in the order they started", () => {
    const view = enCeMoment(apply(searchStarted, webSearch, webSearchEnded, reading, replyStarted, consults), searchPage, NOW);

    expect(view.elsewhere).toEqual([]);
    expect(view.here.map((item) => item.action.key)).toEqual(["job_search:s1", "coach_reply:1"]);
    const [search, reply] = view.here;
    expect(search).toMatchObject({ activity: "read", label: "read", live: true, finished: 1, ms: 12_000 });
    // The Coach reply's tool step: the toolbox (#788).
    expect(reply).toMatchObject({ activity: "act", label: "act", live: true, finished: 0, ms: 8_000 });
  });

  it("lists another page's actions under « En cours ailleurs », each knowing its page", () => {
    const view = enCeMoment(apply(searchStarted, webSearch, replyStarted), "/candidatures", NOW);

    expect(view.here).toEqual([]);
    expect(view.elsewhere.map((item) => [item.action.key, item.action.href])).toEqual([
      ["job_search:s1", searchPage],
      ["coach_reply:1", searchPage],
    ]);
  });

  it("gives a Coach reply its tool steps, ended and under way, never its AI steps (the Guardrail's check, the writing)", () => {
    const [reply] = enCeMoment(apply(replyStarted, consults, consulted, checks, proposes), searchPage, NOW).here;

    expect(reply!.toolSteps.map(({ id, label, running }) => ({ id, label, running }))).toEqual([
      { id: 1, label: "act", running: false },
      { id: 3, label: "propose", running: true },
    ]);
    // The Guardrail's check still runs: only the Coach Action's read is finished.
    expect(reply!.finished).toBe(1);
    expect(reply).toMatchObject({ activity: "act", label: "propose", step: 3 });
  });

  it("starts with the brain, live, before its first step", () => {
    const [reply] = enCeMoment(apply(replyStarted), searchPage, NOW).here;
    expect(reply).toMatchObject({ activity: "think", live: true, finished: 0, toolSteps: [] });
  });

  it("lets a finished action leave: a Job Search done is no longer in it, a Coach reply given neither", () => {
    const done = apply(
      searchStarted,
      webSearch,
      { type: "job_searches", running: [], ended: [{ jobSearchId: "s1", outcome: { status: "done", at: later(10), found: 3, steps: [] } }], at: later(10) },
      replyStarted,
      consults,
      { type: "ended", key: "coach_reply:1", outcome: "done", at: later(11) },
    );
    expect(enCeMoment(done, searchPage, NOW)).toEqual({ here: [], elsewhere: [] });
  });

  it("keeps a stopped or failed action, still, its time until it ended, the steps finished before", () => {
    const stopped = apply(searchStarted, webSearch, webSearchEnded, reading, { type: "ended", key: "job_search:s1", outcome: "stopped", at: later(5) });
    const [search] = enCeMoment(stopped, searchPage, NOW).here;
    expect(search).toMatchObject({ live: false, activity: "read", finished: 1, ms: 5_000 });
    expect(search!.action.status).toBe("stopped");

    const failed = apply(replyStarted, consults, { type: "ended", key: "coach_reply:1", outcome: "failed", at: later(7), reason: "failureReasons.provider_unavailable" });
    const [reply] = enCeMoment(failed, searchPage, NOW).here;
    expect(reply).toMatchObject({ live: false, activity: "act", finished: 0, ms: 3_000 });
    expect(reply!.action.failure).toEqual({ reason: "failureReasons.provider_unavailable", step: "act" });
  });

  it("never counts a time below zero (a clock a little behind the action's start)", () => {
    const [search] = enCeMoment(apply(searchStarted), searchPage, Date.parse(at) - 500).here;
    expect(search!.ms).toBe(0);
  });
});

describe("the glyph of an action under way, the same in « En ce moment » and on « Activité » in the Top Bar (#333, ADR-0034)", () => {
  const [before] = apply(searchStarted);
  const [between] = apply(searchStarted, webSearch, webSearchEnded);
  const [proposing] = apply(replyStarted, consults, consulted, proposes);

  it("is the brain before the first step", () => {
    expect(glyphNow(before!)).toEqual({ activity: "think", label: undefined, step: undefined });
  });

  it("between two steps, stays the last step's, not the brain of before the first", () => {
    expect(glyphNow(between!)).toEqual({ activity: "web_search", label: "web_search", step: 1 });
  });

  it("is the step under way's, with its label and its id: a Coach Action that proposes draws its card, and the next step morphs in", () => {
    expect(glyphNow(proposing!)).toEqual({ activity: "act", label: "propose", step: 3 });
  });

  it("is what « En ce moment » draws", () => {
    for (const action of [before!, between!, proposing!]) {
      const [item] = [...enCeMoment([action], searchPage, NOW).here];
      expect(glyphNow(action)).toEqual({ activity: item!.activity, label: item!.label, step: item!.step });
    }
  });
});
