/**
 * The e2e suite's fake Mistral (fake-mistral.mjs), driven through the real Mistral adapter and AI layer: a Candidate
 * message holding "E2E_COACH_TOOL=<name>:<json>" has the AI Coach call that tool once, then answer in text (#712).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAiLayer, createMistralProvider, type ToolRunner } from "@jobhub/ai";
import { createMemoryUsageLog } from "@jobhub/ai/testing";

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
