import { readProvenance, type ProvenanceEvent, type SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { createAiLayer } from "./ai-layer";
import { createProvenanceRecorder } from "./provenance-recorder";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

const criteria: SearchCriteria = { targetRole: "Développeur", locations: ["Paris"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

/** A clock the test moves: every reading is `step` ms after the last. */
function steppingClock(step = 10) {
  let ms = Date.parse("2026-10-23T10:00:00.000Z");
  return () => {
    const now = new Date(ms);
    ms += step;
    return now;
  };
}

function aiLayer() {
  const claude = createFakeProvider({ id: "anthropic", reply: '["Développeur web", "Ingénieur logiciel"]', usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 50 } });
  const perplexity = createFakeProvider({ id: "perplexity", sources: ["https://www.apec.fr/offre/1"] });
  return createAiLayer({
    providers: [claude, perplexity],
    routes: { job_titles: "anthropic", offer_analysis: "anthropic", writing: "anthropic", web_search: "perplexity" },
    usage: createMemoryUsageLog(),
  });
}

describe("a ProvenanceRecorder", () => {
  it("records each AI call as a step: its task's Activity, the provider, endpoint and model that served, tokens with the cached input", async () => {
    const recorder = createProvenanceRecorder(aiLayer(), { now: steppingClock() });

    await recorder.ai.generate({ task: "writing", candidateId: "c1", prompt: "Lettre" });

    const provenance = recorder.provenance();
    expect(provenance.steps).toEqual([
      {
        kind: "ai",
        activity: "write",
        task: "writing",
        provider: "anthropic",
        endpoint: expect.any(String),
        model: expect.any(String),
        tokens: { input: 150, output: 20 },
        ms: expect.any(Number),
        at: "2026-10-23T10:00:00.010Z",
        outcome: "ok",
        count: 1,
      },
    ]);
    expect(readProvenance(JSON.parse(JSON.stringify(provenance)))).toEqual(provenance);
  });

  it("records a feature step's calls with its Activity", async () => {
    const recorder = createProvenanceRecorder(aiLayer());

    await recorder.aiFor("read_job_page").generate({ task: "offer_analysis", candidateId: null, prompt: "Page" });
    await recorder.ai.generate({ task: "offer_analysis", candidateId: null, prompt: "Offre" });

    expect(recorder.provenance().steps.map(({ activity }) => activity)).toEqual(["read", "think_write"]);
  });

  it("records the job title step of a Job Search plan, and the web search of Company News", async () => {
    const recorder = createProvenanceRecorder(aiLayer());

    await recorder.ai.planJobSearch({ candidateId: null, criteria });
    await recorder.ai.searchCompanyNews({ candidateId: null, employer: "Acme" });

    expect(recorder.provenance().steps).toMatchObject([
      { kind: "ai", task: "job_titles", activity: "think", provider: "anthropic", outcome: "ok" },
      { kind: "ai", task: "web_search", activity: "web_search", provider: "perplexity", outcome: "ok" },
    ]);
  });

  it("times a Tool call and a rule as steps of their own", async () => {
    const recorder = createProvenanceRecorder(aiLayer(), { now: steppingClock(30) });

    const offers = await recorder.step({ tool: "france-travail" }, async () => ["offre"]);
    const score = await recorder.step({ rule: "match_score" }, () => 72);

    expect([offers, score]).toEqual([["offre"], 72]);
    expect(recorder.provenance().steps).toEqual([
      { kind: "tool", activity: "search", tool: "france-travail", ms: 30, at: "2026-10-23T10:00:00.030Z", outcome: "ok", count: 1 },
      { kind: "rules", activity: "compute", rule: "match_score", ms: 30, at: "2026-10-23T10:00:00.090Z", outcome: "ok", count: 1 },
    ]);
  });

  it("records a failed call or Tool as failed, and rethrows", async () => {
    const failing = createAiLayer({ providers: [createFakeProvider({ fail: new Error("down") })], routes: { writing: "anthropic" }, usage: createMemoryUsageLog() });
    const recorder = createProvenanceRecorder(failing);

    await expect(recorder.ai.generate({ task: "writing", candidateId: null, prompt: "Lettre" })).rejects.toThrow();
    await expect(recorder.step({ tool: "job-site" }, () => Promise.reject(new Error("404")))).rejects.toThrow("404");

    expect(recorder.provenance().steps).toMatchObject([
      { kind: "ai", task: "writing", outcome: "failed", count: 1 },
      { kind: "tool", tool: "job-site", outcome: "failed", count: 1 },
    ]);
    expect(recorder.provenance().steps[0]).not.toHaveProperty("model");
  });

  it("records a call the Candidate stopped as stopped", async () => {
    const pending = createAiLayer({ providers: [createFakeProvider({ pending: true })], routes: { writing: "anthropic" }, usage: createMemoryUsageLog() });
    const recorder = createProvenanceRecorder(pending);
    const stop = new AbortController();

    const call = recorder.ai.generate({ task: "writing", candidateId: null, prompt: "Lettre", signal: stop.signal });
    stop.abort();
    await expect(call).rejects.toBeDefined();

    expect(recorder.provenance().steps).toMatchObject([{ kind: "ai", task: "writing", outcome: "stopped" }]);
  });

  it("emits step_started and step_ended for each call, to its sink", async () => {
    const events: ProvenanceEvent[] = [];
    const recorder = createProvenanceRecorder(aiLayer(), { onEvent: (event) => events.push(event), now: steppingClock() });

    await recorder.step({ tool: "france-travail" }, async () => []);
    await recorder.ai.generate({ task: "writing", candidateId: null, prompt: "Lettre" });

    expect(events).toEqual([
      { type: "step_started", id: 1, step: { kind: "tool", activity: "search", tool: "france-travail", at: "2026-10-23T10:00:00.010Z" } },
      { type: "step_ended", id: 1, step: expect.objectContaining({ kind: "tool", tool: "france-travail", outcome: "ok", count: 1 }) },
      { type: "step_started", id: 2, step: { kind: "ai", activity: "write", task: "writing", at: "2026-10-23T10:00:00.030Z" } },
      { type: "step_ended", id: 2, step: expect.objectContaining({ kind: "ai", task: "writing", provider: "anthropic", outcome: "ok", count: 1 }) },
    ]);
  });

  it("is not stopped by a sink that throws", async () => {
    const recorder = createProvenanceRecorder(aiLayer(), {
      onEvent: () => {
        throw new Error("sink down");
      },
    });

    await expect(recorder.step({ rule: "ats_score" }, () => 80)).resolves.toBe(80);
  });

  it("keeps the sites read, each link through the link filter, the Candidate's own pages apart", () => {
    const recorder = createProvenanceRecorder(aiLayer());

    recorder.site("https://www.apec.fr/offre/1?xtor=AL");
    recorder.site("https://apec.fr/offre/2");
    recorder.site("https://www.apec.fr/offre/1");
    recorder.site("https://www.linkedin.com/in/jean-dupont");
    recorder.site("https://boards.greenhouse.io/acme/jobs/4567890");
    recorder.site("/profils/4b1c");
    recorder.site("/admin/outils");
    recorder.site("http://intranet/offre/1");

    expect(recorder.provenance().sites).toEqual([
      { kind: "web", domain: "apec.fr", links: ["https://www.apec.fr/offre/1", "https://apec.fr/offre/2"] },
      { kind: "web", domain: "boards.greenhouse.io", links: ["https://boards.greenhouse.io/acme/jobs/4567890"] },
      { kind: "candidate", links: ["/profils/4b1c"] },
    ]);
  });

  it("builds the stored object with the action's start and wall-clock time", () => {
    const recorder = createProvenanceRecorder(aiLayer(), { now: steppingClock(500) });

    expect(recorder.provenance()).toEqual({ v: 1, steps: [], sites: [], startedAt: "2026-10-23T10:00:00.000Z", wallMs: 500 });
  });

  it("folds a 30-offer Job Search to a few dozen steps", async () => {
    const recorder = createProvenanceRecorder(aiLayer());
    const plan = await recorder.ai.planJobSearch({ candidateId: null, criteria });
    for (const query of plan.queries) await recorder.ai.searchWeb({ candidateId: null, criteria, query });
    await recorder.step({ tool: "france-travail" }, async () => []);
    await recorder.step({ tool: "france-travail" }, async () => []);
    await recorder.step({ tool: "fantastic-jobs" }, async () => []);
    for (let offer = 1; offer <= 30; offer++) {
      const read = offer <= 10 ? "greenhouse" : offer <= 15 ? "lever" : offer <= 20 ? "apec" : "job-site";
      await recorder.step({ tool: read }, async () => offer).catch(() => undefined);
      await recorder.aiFor("read_job_page").generate({ task: "offer_analysis", candidateId: null, prompt: `Page ${offer}` });
      await recorder.step({ rule: "offer_dedup" }, () => true);
      await recorder.step({ rule: "offer_freshness" }, () => true);
      await recorder.step({ rule: "match_score" }, () => 70);
      recorder.site(`https://jobs.example${offer % 4}.com/offre/${offer}`);
    }
    await recorder.step({ tool: "job-site" }, () => Promise.reject(new Error("timeout"))).catch(() => undefined);

    const provenance = recorder.provenance();

    const calls = 1 + plan.queries.length + 3 + 30 * 5 + 1;
    expect(provenance.steps.reduce((sum, step) => sum + step.count, 0)).toBe(calls);
    expect(calls).toBeGreaterThan(150);
    expect(provenance.steps.length).toBeLessThanOrEqual(36);
    expect(provenance.steps.map((step) => [step.kind === "ai" ? step.task : step.kind === "tool" ? step.tool : step.rule, step.outcome, step.count])).toEqual([
      ["job_titles", "ok", 1],
      ["web_search", "ok", plan.queries.length],
      ["france-travail", "ok", 2],
      ["fantastic-jobs", "ok", 1],
      ["greenhouse", "ok", 10],
      ["offer_analysis", "ok", 30],
      ["offer_dedup", "ok", 30],
      ["offer_freshness", "ok", 30],
      ["match_score", "ok", 30],
      ["lever", "ok", 5],
      ["apec", "ok", 5],
      ["job-site", "ok", 10],
      ["job-site", "failed", 1],
    ]);
    const analysis = provenance.steps.find((step) => step.kind === "ai" && step.task === "offer_analysis");
    expect(analysis).toMatchObject({ activity: "read", tokens: { input: 30 * 150, output: 30 * 20 } });
    expect(provenance.sites).toHaveLength(4);
    expect(readProvenance(JSON.parse(JSON.stringify(provenance)))).toEqual(provenance);
  });
});
