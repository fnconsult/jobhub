import type { ProvenanceEvent, ProvenanceStep } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { liveView, nextLive, type LiveAction, type LiveChange, type LiveEnded } from "./live";

const at = "2026-10-24T08:00:00.000Z";
const replyStarted: LiveChange = { type: "started", key: "coach_reply:1", kind: "coach_reply", href: "/offres/1", at };

const apply = (...changes: LiveChange[]): LiveAction[] => changes.reduce<LiveAction[]>((actions, change) => nextLive(actions, change), []);
const step = (key: string, event: ProvenanceEvent): LiveChange => ({ type: "step", key, event });

describe("AI Activity's live actions", () => {
  it("a Coach reply started shows its step under way, by its Activity and Step label", () => {
    const actions = apply(replyStarted, step("coach_reply:1", { type: "step_started", id: 1, step: { kind: "ai", activity: "think_write", task: "coaching", at } }));

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "coach_reply", href: "/offres/1", status: "running", startedAt: at });
    expect(actions[0]!.current).toMatchObject({ activity: "think_write", label: "think_write", running: true });
  });

  it("an ended step replaces its start, with the model that served (named for people), its tokens and time", () => {
    const ended: ProvenanceStep = {
      kind: "ai", activity: "think_write", task: "coaching", provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-large-latest",
      tokens: { input: 1200, output: 300 }, ms: 2400, at, outcome: "ok", count: 1,
    };
    const actions = apply(
      replyStarted,
      step("coach_reply:1", { type: "step_started", id: 1, step: { kind: "ai", activity: "think_write", task: "coaching", at } }),
      step("coach_reply:1", { type: "step_ended", id: 1, step: ended }),
      step("coach_reply:1", { type: "step_started", id: 2, step: { kind: "tool", activity: "read", tool: "job-site", at } }),
      step("coach_reply:1", { type: "step_ended", id: 2, step: { kind: "tool", activity: "read", tool: "job-site", ms: 800, at, outcome: "ok", count: 1 } }),
    );

    const [action] = actions;
    expect(action!.steps).toEqual([
      { id: 1, activity: "think_write", label: "think_write", running: false, outcome: "ok", model: "Mistral Large", tool: null, tokens: 1500, ms: 2400, at, count: 1 },
      { id: 2, activity: "read", label: "read", running: false, outcome: "ok", model: null, tool: "Sites d'emploi", tokens: null, ms: 800, at, count: 1 },
    ]);
    expect(action!.current).toBeNull();
    expect(action!.tokens).toBe(1500);
  });

  it("each step keeps its hour; an ended one, how many calls it folded (its result: « 12 pages lues »)", () => {
    const reading = "2026-10-24T08:00:02.000Z";
    const [action] = apply(
      replyStarted,
      step("coach_reply:1", { type: "step_started", id: 1, step: { kind: "tool", activity: "read", tool: "job-site", at: reading } }),
    );
    expect(action!.steps).toMatchObject([{ id: 1, running: true, at: reading, count: null }]);

    const [ended] = nextLive([action!], step("coach_reply:1", { type: "step_ended", id: 1, step: { kind: "tool", activity: "read", tool: "job-site", ms: 800, at: reading, outcome: "ok", count: 12 } }));
    expect(ended!.steps).toMatchObject([{ id: 1, running: false, at: reading, count: 12 }]);
  });

  const thinking = step("coach_reply:1", { type: "step_started", id: 1, step: { kind: "ai", activity: "think_write", task: "coaching", at } });
  const ended = "2026-10-24T08:00:05.000Z";

  it("a Coach reply given goes: the page's elements count it from then on (its done line is the reply's own Provenance line)", () => {
    expect(apply(replyStarted, thinking, { type: "ended", key: "coach_reply:1", outcome: "done", at: ended })).toEqual([]);
  });

  it("a stopped Coach reply stays, stopped, with its finished steps and the one the Stop ended", () => {
    const [action] = apply(replyStarted, thinking, { type: "stopping", key: "coach_reply:1" });
    expect(action).toMatchObject({ status: "stopping" });

    const [stopped] = apply(replyStarted, thinking, { type: "stopping", key: "coach_reply:1" }, { type: "ended", key: "coach_reply:1", outcome: "stopped", at: ended });
    expect(stopped).toMatchObject({ status: "stopped", endedAt: ended, current: null, failure: null });
    expect(stopped!.steps).toMatchObject([{ id: 1, running: false, outcome: "stopped" }]);
  });

  it("a failed Coach reply says why, in words, and during which step", () => {
    const [failed] = apply(replyStarted, thinking, { type: "ended", key: "coach_reply:1", outcome: "failed", at: ended, reason: "failureReasons.provider_unavailable" });
    expect(failed).toMatchObject({ status: "failed", failure: { reason: "failureReasons.provider_unavailable", step: "think_write" } });
    expect(failed!.steps).toMatchObject([{ running: false, outcome: "failed" }]);
  });

  it("the next Coach reply takes the place of the one stopped or failed before it", () => {
    const actions = apply(replyStarted, thinking, { type: "ended", key: "coach_reply:1", outcome: "stopped", at: ended }, { ...replyStarted, key: "coach_reply:2" });
    expect(actions.map((action) => action.key)).toEqual(["coach_reply:2"]);
  });

  describe("a Job Search, from the page's poll", () => {
    const id = "3f1c2a4e-0000-4000-8000-000000000001";
    const profile = { id: "p1", name: "DAF Lyon" };
    const searching = (steps: ProvenanceEvent[]): LiveChange => ({ type: "job_searches", running: [{ jobSearchId: id, profile, startedAt: at, steps }], ended: [], at });
    const webSearch: ProvenanceEvent = { type: "step_started", id: 1, step: { kind: "ai", activity: "web_search", task: "web_search", at } };
    const over = (outcome: LiveEnded["outcome"]): LiveChange => ({ type: "job_searches", running: [], ended: [{ jobSearchId: id, outcome }], at });

    it("runs on its own page, named by its Profile, with the steps the worker wrote so far", () => {
      const [action] = apply(searching([webSearch]));
      expect(action).toMatchObject({ key: `job_search:${id}`, kind: "job_search", href: `/recherches/${id}`, name: "DAF Lyon", status: "running", startedAt: at });
      expect(action!.current).toMatchObject({ activity: "web_search", label: "web_search" });
    });

    it("seen from its start, it is told as starting; found running later (a page loaded again), it is not", () => {
      const justNow = "2026-10-24T08:00:10.000Z";
      expect(apply(replyStarted)[0]!.seenFromStart).toBe(true);
      expect(apply({ ...searching([]), at: justNow } as LiveChange)[0]!.seenFromStart).toBe(true);
      expect(apply({ ...searching([]), at: "2026-10-24T08:05:00.000Z" } as LiveChange)[0]!.seenFromStart).toBe(false);
    });

    it("each poll brings its latest steps: an ended step in place of its start", () => {
      const [action] = apply(
        searching([webSearch]),
        searching([{ type: "step_ended", id: 1, step: { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", model: "sonar", tokens: { input: 300, output: 800 }, ms: 4100, at, outcome: "ok", count: 1 } }]),
      );
      expect(action!.steps).toMatchObject([{ id: 1, running: false, model: "Perplexity", tokens: 1100 }]);
      expect(action!.current).toBeNull();
    });

    it("done, it stays done with its wall-clock time (« ✓ Dernière recherche · 16 s »), its running steps ended; stopped, it says so; failed, why and during which step", () => {
      const done = "2026-10-24T08:00:16.000Z";
      const [finished] = apply(searching([webSearch]), over({ status: "done", at: done, found: 3, steps: [] }));
      expect(finished).toMatchObject({ status: "done", startedAt: at, endedAt: done, current: null, failure: null });
      expect(finished!.steps).toMatchObject([{ id: 1, running: false }]);
      expect(liveView([finished!], "/").underWay).toBeNull();
      expect(apply(searching([webSearch]), over({ status: "stopped", at: ended, found: 1 }))[0]).toMatchObject({ status: "stopped", endedAt: ended });
      expect(apply(searching([webSearch]), over({ status: "failed", failure: "discovery_failed", at: ended, step: "web_search", found: 0 }))[0]).toMatchObject({
        status: "failed",
        endedAt: ended,
        failure: { reason: "jobSearch.failureReasons.discovery_failed", step: "web_search" },
      });
    });

    it("done, its steps are its Provenance's, folded: each ended, with its result, even the one still running at the last poll", () => {
      const reading = "2026-10-24T08:00:06.000Z";
      const final: ProvenanceStep[] = [
        { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", model: "sonar", tokens: { input: 300, output: 800 }, ms: 4100, at, outcome: "ok", count: 3 },
        { kind: "tool", activity: "read", tool: "job-site", ms: 9000, at: reading, outcome: "ok", count: 12 },
      ];
      const [finished] = apply(searching([webSearch]), over({ status: "done", at: "2026-10-24T08:00:16.000Z", found: 3, steps: final }));
      expect(finished!.steps).toMatchObject([
        { activity: "web_search", running: false, outcome: "ok", count: 3, at, model: "Perplexity", tokens: 1100 },
        { activity: "read", running: false, outcome: "ok", count: 12, at: reading },
      ]);
      expect(finished!.tokens).toBe(1100);
    });

    it("its notification dismissed, or one never seen running, shows nothing", () => {
      const stopped = apply(searching([webSearch]), over({ status: "stopped", at: ended, found: 1 }));
      expect(nextLive(stopped, { type: "job_searches", running: [], ended: [], at })).toEqual([]);
      expect(apply(over({ status: "failed", failure: "timeout", at: ended, step: null, found: 0 }))).toEqual([]);
    });

    it("a poll leaves the Coach reply on its way as it is", () => {
      const actions = apply(replyStarted, thinking, searching([webSearch]));
      expect(actions.map((action) => action.key)).toEqual(["coach_reply:1", `job_search:${id}`]);
      expect(nextLive(actions, { type: "job_searches", running: [], ended: [], at }).map((action) => action.key)).toEqual(["coach_reply:1"]);
    });
  });

  describe("what AI Activity shows", () => {
    const search: LiveChange = { type: "started", key: "job_search:1", kind: "job_search", href: "/recherches/1", at };

    it("the closed button follows the latest action under way; the pane, this page's, then those « En cours ailleurs »", () => {
      const actions = apply(search, replyStarted, thinking);
      const onTheOffer = liveView(actions, "/offres/1");
      expect(onTheOffer.underWay?.key).toBe("coach_reply:1");
      expect(onTheOffer.here.map((action) => action.key)).toEqual(["coach_reply:1"]);
      expect(onTheOffer.elsewhere.map((action) => action.key)).toEqual(["job_search:1"]);

      const elsewhere = liveView(actions, "/candidatures");
      expect(elsewhere.here).toEqual([]);
      expect(elsewhere.elsewhere).toHaveLength(2);
    });

    it("a stopped or failed action is in the pane, not on the closed button", () => {
      const actions = apply(search, replyStarted, thinking, { type: "ended", key: "coach_reply:1", outcome: "failed", at: ended });
      const view = liveView(actions, "/offres/1");
      expect(view.underWay?.key).toBe("job_search:1");
      expect(view.here.map((action) => action.status)).toEqual(["failed"]);

      expect(liveView(nextLive(actions, { type: "ended", key: "job_search:1", outcome: "stopped", at: ended }), "/").underWay).toBeNull();
    });
  });
});
