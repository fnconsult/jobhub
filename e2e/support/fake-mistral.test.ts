/**
 * The e2e suite's fake Mistral (fake-mistral.mjs), driven through the real Mistral adapter and AI layer: a Candidate
 * message holding "E2E_COACH_TOOL=<name>:<json>" has the AI Coach call that tool once, then answer in text (#712).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAiLayer, createMistralProvider, type ToolRunner } from "@jobhub/ai";
import { createMemoryUsageLog } from "@jobhub/ai/testing";
import { NO_INDUSTRY_REFERENCE } from "@jobhub/shared";
import { interviewDraft, interviewInputSchema, nextInterviewTurn, replied, type ExchangeTurn, type InterviewDraft, type InterviewReply } from "@/onboarding-interview";

beforeAll(async () => {
  // It stands in for api.eu.mistral.ai by replacing globalThis.fetch, as the e2e web server preloads it.
  await import("./fake-mistral.mjs");
});

const TOOLS = [{ name: "candidatures_lister", description: "Liste les candidatures.", parameters: { type: "object", properties: { statut: { type: "string" } } } }];

function coach() {
  const usage = createMemoryUsageLog();
  const ai = createAiLayer({ providers: [createMistralProvider({ apiKey: "e2e-mistral-key" })], routes: { coaching: "mistral" }, usage });
  const runTool = vi.fn<ToolRunner>(async () => ({ content: "2 candidatures envoyées" }));
  const ask = (prompt: string, extra = {}) => ai.generate({ task: "coaching", candidateId: "cand-1", system: "Tu es le coach Jobbbox.", prompt, tools: TOOLS, runTool, ...extra });
  return { ask, runTool, usage };
}

describe("fake Mistral: E2E_COACH_TOOL (#712)", () => {
  it("calls the tool with its arguments, then answers with what the tool gave back", async () => {
    const { ask, runTool, usage } = coach();

    const result = await ask('Où en suis-je ? E2E_COACH_TOOL=candidatures_lister:{"statut":"envoyée"}');

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool.mock.calls[0]![0]).toMatchObject({ name: "candidatures_lister", arguments: { statut: "envoyée" }, round: 1 });
    expect(result.text).toBe("Résultat de l'outil « candidatures_lister » : 2 candidatures envoyées");
    expect(result.tools).toMatchObject({ supported: true, rounds: 1 });
    expect(usage.entries).toHaveLength(2);
  });

  it("with several markers, calls each tool in turn, one a round, then answers with the last one's result (#788)", async () => {
    const { ask, runTool } = coach();

    const result = await ask('Où en suis-je ? E2E_COACH_TOOL=candidatures_lister:{"statut":"envoyée"} E2E_COACH_TOOL=candidatures_lister:{"statut":"entretien"}', {
      maxToolRounds: 2,
    });

    expect(runTool.mock.calls.map(([call]) => [call.arguments, call.round])).toEqual([
      [{ statut: "envoyée" }, 1],
      [{ statut: "entretien" }, 2],
    ]);
    expect(result.text).toBe("Résultat de l'outil « candidatures_lister » : 2 candidatures envoyées");
    expect(result.tools).toMatchObject({ supported: true, rounds: 2 });
  });

  it("answers as before without the marker, and without tools", async () => {
    const { ask, runTool } = coach();

    const withTools = await ask("Bonjour");
    const without = await ask('E2E_COACH_TOOL=candidatures_lister:{"statut":"envoyée"}', { tools: undefined, runTool: undefined });

    expect(runTool).not.toHaveBeenCalled();
    expect(withTools.tools?.rounds).toBe(0);
    expect(without).not.toHaveProperty("tools");
  });

  it("asked for text only, answers in text", async () => {
    const { ask, runTool } = coach();

    const result = await ask('E2E_COACH_TOOL=candidatures_lister:{"statut":"envoyée"}', { maxToolRounds: 0 });

    expect(runTool).not.toHaveBeenCalled();
    // The AI Coach's usual reply (one message, no profile in view).
    expect(result.text).toBe("Je ne vois aucun profil. (1 message)");
  });
});

describe("fake Mistral: the onboarding interview (#1002), as the e2e suite plays it", () => {
  const ai = createAiLayer({ providers: [createMistralProvider({ apiKey: "e2e-mistral-key" })], routes: { onboarding_interview: "mistral" }, usage: createMemoryUsageLog() });
  const places = { suggest: async () => [] };
  const blank = interviewDraft({ masterCv: { fullName: "", headline: "", email: "", phone: "", location: "", summary: "", experience: [], education: [], skills: [], languages: [] }, searchCriteria: { targetRole: "", locations: [] } });

  /** Plays the interview: each turn asked, then answered with the next reply, as the page does. */
  async function play(replies: InterviewReply[], opener?: string) {
    let draft: InterviewDraft = blank;
    const exchange: ExchangeTurn[] = [];
    const turns = [];
    for (;;) {
      const input = interviewInputSchema.parse({ language: "fr", draft, exchange, ...(opener ? { opener } : {}) });
      const next = await nextInterviewTurn(input, { ai: () => ai, candidateId: "cand-1", places, industries: async () => NO_INDUSTRY_REFERENCE });
      if (!next) return { turns, draft, fallback: true };
      turns.push(next.turn);
      const reply = replies.shift();
      if (next.turn.done || !reply) return { turns, draft, fallback: false };
      draft = replied(draft, next.turn, reply);
      exchange.push({ ask: next.turn.ask, ...(next.turn.proposal ? { proposal: next.turn.proposal } : {}), reply });
    }
  }

  it("challenges a one-word role, proposes the CDI to validate, then is done", async () => {
    const { turns, draft } = await play([
      { kind: "answer", text: "Finance" },
      { kind: "answer", text: "Directrice financière" },
      { kind: "answer", text: "Lyon" },
      { kind: "accepted" },
      { kind: "answer", text: "Hybride", choice: "hybrid" },
      { kind: "skipped" },
    ]);
    expect(turns.map((turn) => turn.ask.field)).toEqual(["targetRole", "targetRole", "locations", "contractTypes", "remoteWorkOptions", "minSalary", "summary"]);
    expect(turns[1]!.challenge).toMatch(/« Finance » est trop vague/);
    expect(turns[3]!.proposal).toMatchObject({ field: "contractTypes", value: ["cdi"], shown: "CDI" });
    expect(turns.at(-1)!.done).toBe(true);
    expect(draft.searchCriteria).toMatchObject({ targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: ["cdi"], remoteWorkOptions: ["hybrid"] });
  });

  it("fails once E2E_AI_DOWN is in what it is sent: the scripted questions take over", async () => {
    const { turns, fallback } = await play([{ kind: "answer", text: "Directrice financière" }, { kind: "answer", text: "E2E_AI_DOWN" }]);
    expect(turns.map((turn) => turn.ask.field)).toEqual(["targetRole", "locations"]);
    expect(fallback).toBe(true);
  });
});
