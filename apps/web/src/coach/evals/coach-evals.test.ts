import { createAiLayer, type AiLayer, type TokenUsage } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import { loadCoachKnowledge, PLAYBOOK_IDS } from "@jobhub/coach-knowledge";
import { describe, expect, it } from "vitest";
import { COACH_EVAL_CASES, renderCoachEvalReport, runCoachEval, type CoachEvalCase } from "./index";

const knowledge = loadCoachKnowledge({ environment: "eval" });

const nadia: CoachEvalCase = {
  id: "age-worry",
  candidate: {
    firstName: "Nadia",
    targetRole: "Directrice financière",
    location: "Lyon",
    experience: [{ title: "Directrice financière", employer: "Groupe Exemple", period: "2008 – 2026" }],
    skills: ["IFRS", "Contrôle de gestion"],
  },
  messages: [{ from: "candidate", text: "J'ai 58 ans, est-ce que je suis trop âgée pour retrouver un poste ?" }],
  expected: "Rassure sans rien promettre et valorise l'expérience comme un atout pour le poste.",
};

/** An AI layer whose `coaching` task answers on `model`, through a fake Claude. */
function aiOn(model: string, options: { reply?: string | (() => string); usage?: TokenUsage } = {}): { ai: AiLayer; provider: FakeProvider } {
  const provider = createFakeProvider({ id: "anthropic", reply: options.reply ?? `Réponse de ${model}`, usage: options.usage });
  return { ai: createAiLayer({ providers: [provider], routes: { coaching: { provider: "anthropic", model } }, usage: createMemoryUsageLog() }), provider };
}

const judgment = (scores: { adherence: number; figures: number; tone: number }, outside: string[] = []) =>
  JSON.stringify({
    adherence: { score: scores.adherence, reason: "Suit le playbook." },
    figures: { score: scores.figures, outside, reason: "Aucun chiffre hors playbook." },
    tone: { score: scores.tone, reason: "Ton respectueux." },
  });

describe("the Coach eval suite", () => {
  it("scores each case's reply on each model with the AI judge, and says what each reply cost", async () => {
    const opus = aiOn("claude-opus-5-5", { usage: { inputTokens: 8_000, outputTokens: 500 } });
    const sonnet = aiOn("claude-sonnet-5-5", { usage: { inputTokens: 8_000, outputTokens: 500 } });
    const judge = aiOn("claude-opus-5-5", { reply: judgment({ adherence: 5, figures: 5, tone: 4 }) });

    const report = await runCoachEval({
      cases: [nadia],
      models: [
        { model: "claude-opus-5-5", ai: opus.ai },
        { model: "claude-sonnet-5-5", ai: sonnet.ai },
      ],
      judge: judge.ai,
      knowledge,
    });

    expect(report.models.map((model) => model.model)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    const [opusResult, sonnetResult] = report.models;
    expect(opusResult!.results).toEqual([
      expect.objectContaining({
        caseId: "age-worry",
        reply: "Réponse de claude-opus-5-5",
        judgment: expect.objectContaining({ adherence: expect.objectContaining({ score: 5 }), figures: expect.objectContaining({ score: 5, outside: [] }), tone: expect.objectContaining({ score: 4 }) }),
        passed: true,
      }),
    ]);
    // 8,000 × $4 + 500 × $20 per million tokens = $0.042, at €0.86 per $: €0.03612. Sonnet costs half.
    expect(opusResult!.results[0]!.cost?.eur).toBeCloseTo(0.03612, 5);
    expect(sonnetResult!.results[0]!.cost?.eur).toBeCloseTo(0.01806, 5);
    // The judge read Nadia's message and Sonnet's reply.
    expect(judge.provider.calls.map((call) => call.messages.at(-1)!.content).join("\n")).toContain("Réponse de claude-sonnet-5-5");
  });

  it("gives the judge the Core Digest and the playbooks the reply drew on, and what a good reply does", async () => {
    const judge = aiOn("claude-opus-5-5", { reply: judgment({ adherence: 5, figures: 5, tone: 5 }) });

    const report = await runCoachEval({ cases: [nadia], models: [{ model: "claude-sonnet-5-5", ai: aiOn("claude-sonnet-5-5").ai }], judge: judge.ai, knowledge });

    // "58 ans" and "âgée": the 40+ positioning playbook.
    expect(report.models[0]!.results[0]!.playbooks?.map((used) => used.id)).toEqual(["core-digest", "senior-40plus-positioning"]);
    const prompt = judge.provider.calls[0]!.messages.at(-1)!.content;
    expect(prompt).toContain(knowledge.coreDigest()!.text);
    expect(prompt).toContain(knowledge.playbook("senior-40plus-positioning")!.text);
    expect(prompt).toContain("J'ai 58 ans");
    expect(prompt).toContain(nadia.expected);
  });

  it("records a reply the Coach could not give, or the judge could not score, as not passed", async () => {
    const failing = createFakeProvider({ id: "anthropic" });
    failing.generate = async () => {
      throw new Error("overloaded");
    };
    const down = createAiLayer({ providers: [failing], routes: { coaching: "anthropic" }, usage: createMemoryUsageLog() });
    const confusedJudge = aiOn("claude-opus-5-5", { reply: "Très bonne réponse, je mettrais 5." });

    const report = await runCoachEval({
      cases: [nadia],
      models: [
        { model: "down", ai: down },
        { model: "claude-sonnet-5-5", ai: aiOn("claude-sonnet-5-5").ai },
      ],
      judge: confusedJudge.ai,
      knowledge,
    });

    expect(report.models[0]!.results).toEqual([{ caseId: "age-worry", passed: false, error: "coach" }]);
    expect(report.models[0]!.summary).toMatchObject({ cases: 1, passed: 0, errors: 1 });
    expect(report.models[1]!.results).toEqual([expect.objectContaining({ caseId: "age-worry", reply: "Réponse de claude-sonnet-5-5", judgment: null, passed: false, error: "judge" })]);
  });
});

describe("the Coach eval suite — comparing models", () => {
  const anotherCase: CoachEvalCase = { ...nadia, id: "long-search", messages: [{ from: "candidate", text: "Je cherche depuis 14 mois, je suis découragée." }] };

  /** Two cases on each model: `costs` in input tokens per reply (output 500), and the judge's tone score per reply. */
  async function compare(models: { model: string; inputTokens: number[]; tone: number[] }[]) {
    const tones = models.flatMap((model) => model.tone);
    const judge = aiOn("claude-opus-5-5", { reply: () => judgment({ adherence: 5, figures: 5, tone: tones.shift()! }) });
    return runCoachEval({
      cases: [nadia, anotherCase],
      models: models.map(({ model, inputTokens }) => {
        const usages = [...inputTokens];
        const provider = createFakeProvider({ id: "anthropic", reply: `Réponse de ${model}` });
        const generate = provider.generate!.bind(provider);
        provider.generate = async (input) => ({ ...(await generate(input)), usage: { inputTokens: usages.shift()!, outputTokens: 500 } });
        return { model, ai: createAiLayer({ providers: [provider], routes: { coaching: { provider: "anthropic", model } }, usage: createMemoryUsageLog() }) };
      }),
      judge: judge.ai,
      knowledge,
    });
  }

  it("sums up each model: replies passed, mean score per criterion, median and p90 cost against the Coach cost target", async () => {
    const report = await compare([{ model: "claude-sonnet-5-5", inputTokens: [6_000, 10_000], tone: [5, 3] }]);

    // Sonnet: 6,000 × $2 + 500 × $10 = $0.017 → €0.01462; 10,000 × $2 + 500 × $10 = $0.025 → €0.0215. p90 interpolated like the Coach cost page.
    expect(report.models[0]!.summary).toEqual({
      cases: 2,
      passed: 1,
      errors: 0,
      scores: { adherence: 5, figures: 5, tone: 4 },
      medianEur: expect.closeTo(0.01806, 5),
      p90Eur: expect.closeTo(0.020812, 5),
      withinTarget: true,
    });
  });

  it("recommends the cheapest model within the Coach cost target that passes about as many cases as the best", async () => {
    const report = await compare([
      { model: "claude-opus-5-5", inputTokens: [8_000, 8_000], tone: [5, 5] },
      { model: "claude-sonnet-5-5", inputTokens: [8_000, 8_000], tone: [5, 5] },
    ]);

    expect(report.models.map((model) => [model.model, model.summary.withinTarget])).toEqual([
      ["claude-opus-5-5", false],
      ["claude-sonnet-5-5", true],
    ]);
    expect(report.recommended).toEqual({ model: "claude-sonnet-5-5", reason: expect.stringMatching(/within/i) });
  });

  it("recommends no model when the one within the cost target passes clearly fewer cases than the best", async () => {
    const report = await compare([
      { model: "claude-opus-5-5", inputTokens: [8_000, 8_000], tone: [5, 5] },
      { model: "claude-sonnet-5-5", inputTokens: [8_000, 8_000], tone: [5, 2] },
    ]);

    expect(report.recommended).toEqual({ model: null, reason: expect.stringMatching(/no model/i) });
  });
});

describe("the Coach eval set", () => {
  it("runs every case through the AI Coach and the judge, each with its own id", async () => {
    const coach = aiOn("claude-sonnet-5-5");
    const report = await runCoachEval({
      cases: COACH_EVAL_CASES,
      models: [{ model: "claude-sonnet-5-5", ai: coach.ai }],
      judge: aiOn("claude-opus-5-5", { reply: judgment({ adherence: 5, figures: 5, tone: 5 }) }).ai,
      knowledge,
    });

    expect(new Set(COACH_EVAL_CASES.map((evalCase) => evalCase.id)).size).toBe(COACH_EVAL_CASES.length);
    expect(report.models[0]!.summary).toMatchObject({ cases: COACH_EVAL_CASES.length, passed: COACH_EVAL_CASES.length, errors: 0 });
    // Every Coaching Playbook is given to the AI Coach by at least one case.
    const used = new Set(report.models[0]!.results.flatMap((result) => result.playbooks!.map((playbook) => playbook.id)));
    expect([...used].sort()).toEqual(["core-digest", ...PLAYBOOK_IDS].sort());
  });

  it("ports devarq's search relevance set: each listing In view as a Job Offer, the Coach asked whether it fits", async () => {
    const ported = COACH_EVAL_CASES.filter((evalCase) => evalCase.origin?.startsWith("devarq job-hub/corpus/evals/search-relevance-v1.json#"));
    const coach = aiOn("claude-sonnet-5-5");

    await runCoachEval({ cases: ported, models: [{ model: "claude-sonnet-5-5", ai: coach.ai }], judge: aiOn("claude-opus-5-5", { reply: judgment({ adherence: 5, figures: 5, tone: 5 }) }).ai, knowledge });

    expect(ported.map((evalCase) => evalCase.origin!.split("#")[1])).toEqual([
      "dsi-aligned",
      "dsi-versus-data",
      "customer-success-aligned",
      "historic-role-does-not-retarget",
      "project-program-alias",
      "technical-trade-profile",
    ]);
    expect(ported.every((evalCase) => evalCase.inView?.kind === "job_offer")).toBe(true);
    // The Coach read the Job Offer In view: "Supply Chain Manager", from the historic-role case.
    expect(coach.provider.calls[3]!.system).toContain("Supply Chain Manager");
  });
});

describe("the Coach eval report", () => {
  it("shows each model's summary, the recommended default, each case's scores and any figure outside the playbooks", async () => {
    const judge = aiOn("claude-opus-5-5", { reply: judgment({ adherence: 5, figures: 2, tone: 4 }, ["73 %"]) });
    const report = await runCoachEval({
      cases: [nadia],
      models: [
        { model: "claude-opus-5-5", ai: aiOn("claude-opus-5-5", { usage: { inputTokens: 8_000, outputTokens: 500 } }).ai },
        { model: "claude-sonnet-5-5", ai: aiOn("claude-sonnet-5-5", { usage: { inputTokens: 8_000, outputTokens: 500 } }).ai },
      ],
      judge: judge.ai,
      knowledge,
    });

    const markdown = renderCoachEvalReport(report, { date: "2026-10-15", commit: "abc1234", setVersion: "coach-v1" });

    expect(markdown).toContain("# Coach eval run, 2026-10-15");
    expect(markdown).toContain("coach-v1");
    expect(markdown).toContain("abc1234");
    expect(markdown).toContain("| claude-opus-5-5 | 0 / 1 | 5.00 | 2.00 | 4.00 | €0.0361 | €0.0361 | no |");
    expect(markdown).toContain("| claude-sonnet-5-5 | 0 / 1 | 5.00 | 2.00 | 4.00 | €0.0181 | €0.0181 | yes |");
    expect(markdown).toMatch(/Recommended default: none/);
    expect(markdown).toContain("| age-worry | 5 / 2 / 4 ✗ | 5 / 2 / 4 ✗ |");
    expect(markdown).toContain("73 %");
  });
});
