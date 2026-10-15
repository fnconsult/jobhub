import { createAiLayer, type AiLayer, type TokenUsage } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import { loadCoachKnowledge } from "@jobhub/coach-knowledge";
import { describe, expect, it } from "vitest";
import { runCoachEval, type CoachEvalCase } from "./index";

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
    expect(report.models[1]!.results).toEqual([expect.objectContaining({ caseId: "age-worry", reply: "Réponse de claude-sonnet-5-5", judgment: null, passed: false, error: "judge" })]);
  });
});
