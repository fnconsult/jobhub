/**
 * Tool calling through the AI layer (#712, ADR-0077): the model calls the caller's tools, the caller's code runs them
 * (`runTool`), the AI layer makes the loop, bounded by `maxToolRounds`. Each turn is one AI call: redacted, scanned
 * for identity, recorded in AI Usage with what it said; the reply costs their sum.
 */
import { describe, expect, it, vi } from "vitest";
import { createAiLayer, type AiLayerOptions, type GenerateRequest, type ToolRunner } from "./ai-layer";
import { costInEur } from "./cost";
import { AiConfigError } from "./errors";
import { createFakeProvider, createMemoryUsageLog, type FakeProviderOptions, type FakeTurn } from "./testing";
import type { ToolDefinition } from "./types";

const TOOLS: ToolDefinition[] = [
  { name: "candidatures_lister", description: "Liste les candidatures.", parameters: { type: "object", properties: { statut: { type: "string" } } } },
  { name: "agenda_lister", description: "Liste les entretiens.", parameters: { type: "object", properties: {} } },
];

const LISTE = (statut = "envoyée"): FakeTurn => ({ text: "Je regarde.", toolCalls: [{ name: "candidatures_lister", arguments: { statut } }] });

function setUp(turns: FakeTurn[], { fake = {}, layer = {} }: { fake?: FakeProviderOptions; layer?: Partial<AiLayerOptions> } = {}) {
  const claude = createFakeProvider({ id: "anthropic", residency: "outside_eu", turns, ...fake });
  const mistral = createFakeProvider({ id: "mistral", reply: "de Mistral" });
  const usage = createMemoryUsageLog();
  const warnings: string[] = [];
  const ai = createAiLayer({ providers: [claude, mistral], routes: { coaching: "anthropic" }, usage, warn: (message) => warnings.push(message), ...layer });
  const runs: Parameters<ToolRunner>[0][] = [];
  const runTool = vi.fn<ToolRunner>(async (call) => {
    runs.push(call);
    return { content: `[{"poste":"DAF","statut":"${String(call.arguments.statut ?? "")}"}]` };
  });
  const ask = (extra: Partial<GenerateRequest> = {}) =>
    ai.generate({ task: "coaching", candidateId: "cand-1", system: "Tu es le coach Jobbbox.", prompt: "Où en sont mes candidatures ?", containsIdentity: false, tools: TOOLS, runTool, ...extra });
  return { ai, claude, mistral, usage, warnings, runTool, runs, ask };
}

describe("tool calling through the AI layer (#712)", () => {
  it("runs a tool the model calls, sends its result back, and answers with the next turn's text", async () => {
    const { claude, runs, ask } = setUp([LISTE(), { text: "Vous avez une candidature envoyée." }]);

    const result = await ask();

    expect(result.text).toBe("Vous avez une candidature envoyée.");
    expect(runs).toEqual([{ id: "call_1", name: "candidatures_lister", arguments: { statut: "envoyée" }, round: 1 }]);
    expect(claude.calls).toHaveLength(2);
    expect(claude.calls[0]!.tools).toEqual(TOOLS);
    expect(claude.calls[1]!.messages).toEqual([
      { role: "user", content: "Où en sont mes candidatures ?" },
      { role: "assistant", content: [{ type: "text", text: "Je regarde." }, { type: "tool_call", id: "call_1", name: "candidatures_lister", arguments: { statut: "envoyée" } }] },
      { role: "user", content: [{ type: "tool_result", id: "call_1", content: '[{"poste":"DAF","statut":"envoyée"}]' }] },
    ]);
    expect(result.tools).toEqual({
      supported: true,
      rounds: 1,
      runs: [{ id: "call_1", name: "candidatures_lister", arguments: { statut: "envoyée" }, round: 1, ran: true, result: { content: '[{"poste":"DAF","statut":"envoyée"}]' }, durationMs: expect.any(Number) }],
    });
  });

  it("gives the tool the call's signal", async () => {
    const { runTool, ask } = setUp([LISTE(), { text: "ok" }]);
    const controller = new AbortController();

    await ask({ signal: controller.signal });

    expect(runTool.mock.calls[0]![1]).toEqual({ signal: controller.signal });
  });

  it("runs every tool of a turn, in order, and sends all their results back together", async () => {
    const { claude, runs, ask } = setUp([{ toolCalls: [{ name: "candidatures_lister", arguments: { statut: "envoyée" } }, { name: "agenda_lister", arguments: {} }] }, { text: "ok" }]);

    await ask();

    expect(runs.map((run) => run.name)).toEqual(["candidatures_lister", "agenda_lister"]);
    expect(claude.calls[1]!.messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", id: "call_1", content: expect.any(String) },
        { type: "tool_result", id: "call_2", content: expect.any(String) },
      ],
    });
  });

  describe("a bounded loop", () => {
    it("past maxToolRounds, a last turn asks for text only, its tools kept to read the calls made", async () => {
      const { claude, runTool, ask } = setUp([LISTE(), LISTE(), LISTE(), { text: "jamais" }]);

      const result = await ask({ maxToolRounds: 2 });

      expect(claude.calls).toHaveLength(3);
      expect(runTool).toHaveBeenCalledTimes(2);
      expect(claude.calls.map((call) => call.toolChoice)).toEqual([undefined, undefined, "none"]);
      expect(claude.calls[2]!.tools).toEqual(TOOLS);
      // The fake's third turn would call again; asked for text only, it answers.
      expect(result.text).toBe("Je regarde.");
      expect(result.tools?.rounds).toBe(2);
    });

    it("is 2 rounds when the caller names none", async () => {
      const { claude, ask } = setUp([LISTE()]);

      await ask();

      expect(claude.calls).toHaveLength(3);
    });

    it("never goes past 4 rounds, whatever the caller asks", async () => {
      const { claude, ask } = setUp([LISTE()]);

      await ask({ maxToolRounds: 10 });

      expect(claude.calls).toHaveLength(5);
    });

    it("0 rounds: one call, without tools, as before tool calling", async () => {
      const { claude, runTool, ask } = setUp([LISTE()]);

      await ask({ maxToolRounds: 0 });

      expect(claude.calls).toHaveLength(1);
      expect(claude.calls[0]).not.toHaveProperty("tools");
      expect(runTool).not.toHaveBeenCalled();
    });

    it("ends as soon as the model answers in text", async () => {
      const { claude, runTool, ask } = setUp([{ text: "Bonjour" }]);

      const result = await ask({ maxToolRounds: 3 });

      expect(claude.calls).toHaveLength(1);
      expect(runTool).not.toHaveBeenCalled();
      expect(result).toMatchObject({ text: "Bonjour", tools: { supported: true, rounds: 0, runs: [] } });
    });
  });

  describe("a call the AI layer refuses to run, its error sent back to the model instead", () => {
    it("an unknown tool is never run", async () => {
      const { claude, runTool, ask } = setUp([{ toolCalls: [{ name: "candidatures_supprimer", arguments: { id: "a1" } }] }, { text: "Je ne peux pas supprimer." }]);

      const result = await ask();

      expect(runTool).not.toHaveBeenCalled();
      expect(claude.calls[1]!.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", id: "call_1", content: 'Unknown tool "candidatures_supprimer": it was not run.', error: true }] });
      expect(result.text).toBe("Je ne peux pas supprimer.");
      expect(result.tools?.runs).toEqual([expect.objectContaining({ name: "candidatures_supprimer", ran: false, result: { content: 'Unknown tool "candidatures_supprimer": it was not run.', error: true } })]);
    });

    it("arguments that are not a JSON object are never run", async () => {
      const { claude, runTool, ask } = setUp([{ toolCalls: [{ name: "candidatures_lister", arguments: '{"statut": ' }] }, { text: "ok" }]);

      await ask();

      expect(runTool).not.toHaveBeenCalled();
      expect(claude.calls[1]!.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", id: "call_1", content: 'The arguments of "candidatures_lister" are not a JSON object: it was not run.', error: true }] });
    });

    it("a tool that fails gives its error to the model, and the call goes on", async () => {
      const { claude, runTool, ask } = setUp([LISTE(), { text: "Désolé." }]);
      runTool.mockRejectedValueOnce(new Error("statut inconnu"));

      const result = await ask();

      expect(claude.calls[1]!.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", id: "call_1", content: 'The tool "candidatures_lister" failed: statut inconnu', error: true }] });
      expect(result.text).toBe("Désolé.");
    });

    it("a result the tool marks as an error is sent as one", async () => {
      const { claude, runTool, ask } = setUp([LISTE(), { text: "ok" }]);
      runTool.mockResolvedValueOnce({ content: "Aucune candidature à ce statut.", error: true });

      await ask();

      expect(claude.calls[1]!.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", id: "call_1", content: "Aucune candidature à ce statut.", error: true }] });
    });
  });

  describe("tools the AI layer refuses before anything is sent", () => {
    it.each([
      ["a name a provider would refuse", { tools: [{ ...TOOLS[0]!, name: "candidatures.lister" }] }],
      ["two tools of one name", { tools: [TOOLS[0]!, TOOLS[0]!] }],
      ["tools without runTool", { runTool: undefined }],
    ])("%s", async (_, extra) => {
      const { claude, usage, ask } = setUp([LISTE()]);

      await expect(ask(extra as Partial<GenerateRequest>)).rejects.toBeInstanceOf(AiConfigError);

      expect(claude.calls).toHaveLength(0);
      expect(usage.entries).toEqual([expect.objectContaining({ outcome: "failed", sent: false })]);
    });
  });

  describe("a provider that does not declare tool calling", () => {
    it("is called without tools, as before, and the result says so", async () => {
      const { claude, runTool, ask } = setUp([LISTE()], { fake: { toolCalling: false } });

      const result = await ask();

      expect(claude.calls).toHaveLength(1);
      expect(Object.keys(claude.calls[0]!)).toEqual(["model", "system", "messages", "maxTokens"]);
      expect(runTool).not.toHaveBeenCalled();
      expect(result.tools).toEqual({ supported: false, rounds: 0, runs: [] });
    });
  });

  it("without tools, a provider that does not declare tool calling is sent the caller's very messages, as before", async () => {
    const { claude, ask } = setUp([], { fake: { toolCalling: false } });
    const prompt = [{ role: "user" as const, content: "Bonjour", at: "2026-11-04" }];

    await ask({ tools: undefined, runTool: undefined, prompt });

    expect(claude.calls[0]!.messages).toStrictEqual(prompt);
  });

  it("without tools, a call is exactly as before: no tools, no tool choice, no tools in its result", async () => {
    const { claude, ask } = setUp([LISTE()]);

    const result = await ask({ tools: undefined, runTool: undefined });

    expect(Object.keys(claude.calls[0]!)).toEqual(["model", "system", "messages", "maxTokens"]);
    expect(result).not.toHaveProperty("tools");
    expect(result).not.toHaveProperty("turns");
  });
});

describe("Redaction and identity routing of tool results (#712)", () => {
  const IDENTITY = { fullName: "Marie Dupont", email: "marie.dupont@example.fr" };

  it("redacts a tool's result before it is sent, and gives the values back in the reply and to the next tool", async () => {
    const { claude, usage, runTool, ask } = setUp(
      [LISTE(), { toolCalls: [{ name: "agenda_lister", arguments: { invitée: "[NOM]" } }] }, { text: "Bonne chance, [NOM] !" }],
      { layer: { identityOf: async () => IDENTITY } },
    );
    runTool.mockResolvedValueOnce({ content: "Candidature de Marie Dupont (marie.dupont@example.fr) chez Globex" });

    const result = await ask({ maxToolRounds: 3 });

    expect(claude.calls[1]!.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", id: "call_1", content: "Candidature de [NOM] ([E-MAIL]) chez Globex" }] });
    expect(JSON.stringify(claude.calls.map((call) => call.messages))).not.toMatch(/Dupont|marie\.dupont/);
    expect(runTool.mock.calls[1]![0].arguments).toEqual({ invitée: "Marie Dupont" });
    expect(result.text).toBe("Bonne chance, Marie Dupont !");
    // The AI Message Log keeps each turn as sent: redacted, its tool calls and results included.
    expect(usage.entries[1]!.transcript.messages.at(-1)).toEqual({ role: "user", content: "[résultat d'outil #call_1] Candidature de [NOM] ([E-MAIL]) chez Globex" });
    expect(usage.entries[1]!.transcript.reply).toBe('[appel d\'outil agenda_lister #call_2] {"invitée":"[NOM]"}');
    expect(JSON.stringify(usage.entries.map((entry) => entry.transcript))).not.toMatch(/Dupont|marie\.dupont/);
  });

  it("redacts what is known of the Candidate even in a tool's arguments written back to the model", async () => {
    const { claude, ask } = setUp([{ toolCalls: [{ name: "candidatures_lister", arguments: { statut: "Marie Dupont" } }] }, { text: "ok" }], { layer: { identityOf: async () => IDENTITY } });

    await ask();

    expect(claude.calls[1]!.messages[1]).toEqual({ role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "candidatures_lister", arguments: { statut: "[NOM]" } }] });
  });

  const consenting = { euAiConsent: async (candidateId: string) => candidateId === "cand-1" };

  it("reroutes the next turns to the EU AI Consent route when a tool's result carries the Identity block, with consent (#571)", async () => {
    const { claude, mistral, usage, runTool, ask } = setUp([LISTE(), { text: "de Claude" }], { layer: consenting });
    runTool.mockResolvedValueOnce({ content: "Bloc d'identité : Marie Dupont, Lyon", containsIdentity: true });

    const result = await ask();

    expect(claude.calls).toHaveLength(1);
    expect(mistral.calls).toHaveLength(1);
    expect(mistral.calls[0]!.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", id: "call_1", content: "Bloc d'identité : Marie Dupont, Lyon" }] });
    expect(result).toMatchObject({ text: "de Mistral", provider: "mistral", euAiConsent: true });
    expect(usage.entries.map((entry) => entry.provider)).toEqual(["anthropic", "mistral"]);
  });

  it("reroutes when the scan finds a phone number or email in a tool's result it did not declare, and warns", async () => {
    const { mistral, usage, runTool, warnings, ask } = setUp([LISTE(), { text: "de Claude" }], { layer: consenting });
    runTool.mockResolvedValueOnce({ content: "Contact : 06 12 34 56 78" });

    const result = await ask();

    expect(mistral.calls).toHaveLength(1);
    expect(result.provider).toBe("mistral");
    expect(warnings).toContain("Undeclared identity in an AI call: routed as identity-bearing");
    expect(usage.entries[1]).toMatchObject({ outcome: "warning", reason: "identity_undeclared" });
  });

  it("keeps the route of a Candidate without consent, the result redacted", async () => {
    const { claude, mistral, runTool, ask } = setUp([LISTE(), { text: "de Claude" }], { layer: { euAiConsent: async () => false } });
    runTool.mockResolvedValueOnce({ content: "Contact : 06 12 34 56 78", containsIdentity: true });

    const result = await ask();

    expect(mistral.calls).toHaveLength(0);
    expect(result.provider).toBe("anthropic");
    expect(claude.calls[1]!.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", id: "call_1", content: "Contact : [TÉLÉPHONE]" }] });
  });

  it("sends a provider without tool calling the conversation as text, once rerouted to it", async () => {
    const { mistral, runTool, ask } = setUp([LISTE(), { text: "de Claude" }], { layer: consenting });
    Object.assign(mistral, { toolCalling: false });
    runTool.mockResolvedValueOnce({ content: "Marie Dupont", containsIdentity: true });

    const result = await ask();

    expect(mistral.calls[0]).not.toHaveProperty("tools");
    expect(mistral.calls[0]!.messages.at(-1)).toEqual({ role: "user", content: "[résultat d'outil #call_1] Marie Dupont" });
    expect(result.tools?.supported).toBe(false);
  });
});

describe("AI Usage of a call with tools (#712)", () => {
  it("records one line per turn, of the same task, each with its tokens and cost; the reply costs their sum", async () => {
    const { usage, ask } = setUp([
      { ...LISTE(), usage: { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 4000 } },
      { text: "ok", usage: { inputTokens: 1200, outputTokens: 80 } },
    ]);

    const result = await ask();

    expect(usage.entries).toHaveLength(2);
    expect(usage.entries.map((entry) => [entry.task, entry.candidateId, entry.outcome, entry.sent])).toEqual([
      ["coaching", "cand-1", "ok", true],
      ["coaching", "cand-1", "ok", true],
    ]);
    expect(usage.entries.map((entry) => [entry.inputTokens, entry.outputTokens, entry.cachedInputTokens])).toEqual([
      [1000, 50, 4000],
      [1200, 80, undefined],
    ]);
    expect(result.usage).toEqual({ inputTokens: 2200, outputTokens: 130, cachedInputTokens: 4000 });
    expect(result.costEur).toBeCloseTo(usage.entries[0]!.costEur + usage.entries[1]!.costEur, 12);
    expect(result.costEur).toBeGreaterThan(0);
  });

  it("the Coach Message Cost of the reply is the sum of its turns', even across two providers", async () => {
    const { usage, runTool, ask } = setUp([{ ...LISTE(), usage: { inputTokens: 1000, outputTokens: 50 } }], { layer: { euAiConsent: async () => true } });
    runTool.mockResolvedValueOnce({ content: "Marie Dupont", containsIdentity: true });

    const result = await ask();

    const turns = usage.entries.map((entry) => costInEur({ provider: entry.provider!, model: entry.model!, usage: entry }));
    expect(usage.entries.map((entry) => entry.provider)).toEqual(["anthropic", "mistral"]);
    expect(costInEur(result)).toBeCloseTo(turns[0]! + turns[1]!, 12);
    expect(result.turns).toEqual([
      { provider: "anthropic", model: "fake-anthropic", usage: { inputTokens: 1000, outputTokens: 50 } },
      { provider: "mistral", model: "fake-mistral", usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
  });

  it("records the feature's warnings once, with the last turn, and checks only the final reply", async () => {
    const unusable = vi.fn(() => null);
    const { usage, ask } = setUp([LISTE(), { text: "ok" }]);

    await ask({ warnings: [{ reason: "task_playbook_fallback" }], unusable });

    expect(usage.entries.map((entry) => entry.outcome)).toEqual(["ok", "warning"]);
    expect(unusable).toHaveBeenCalledTimes(1);
    expect(unusable).toHaveBeenCalledWith("ok");
  });

  it("keeps each turn's transcript: the conversation so far and the turn's reply, tool calls included", async () => {
    const { usage, ask } = setUp([LISTE(), { text: "ok" }]);

    await ask();

    expect(usage.entries[0]!.transcript).toEqual({
      system: "Tu es le coach Jobbbox.",
      messages: [{ role: "user", content: "Où en sont mes candidatures ?" }],
      reply: 'Je regarde.\n[appel d\'outil candidatures_lister #call_1] {"statut":"envoyée"}',
    });
    expect(usage.entries[1]!.transcript.messages).toHaveLength(3);
    expect(usage.entries[1]!.transcript.reply).toBe("ok");
  });
});

describe("Stop during a call with tools (#712, #325)", () => {
  it("aborting a turn in flight stops it: AI Usage stopped, no more turns, no more tools", async () => {
    const controller = new AbortController();
    const { claude, usage, runTool, ask } = setUp([LISTE(), { text: "jamais", pending: true }]);

    const call = ask({ signal: controller.signal });
    await vi.waitFor(() => expect(claude.calls).toHaveLength(2));
    controller.abort();

    await expect(call).rejects.toBe(controller.signal.reason);
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(usage.entries.map((entry) => [entry.outcome, entry.reason, entry.sent])).toEqual([
      ["ok", undefined, true],
      ["failed", "stopped", true],
    ]);
  });

  it("aborting between two turns (while a tool runs) sends no next turn: AI Usage stopped, not sent", async () => {
    const controller = new AbortController();
    const { claude, usage, runTool, ask } = setUp([LISTE(), { text: "jamais" }]);
    runTool.mockImplementationOnce(async () => {
      controller.abort();
      throw controller.signal.reason;
    });

    const error = await ask({ signal: controller.signal }).catch((rejected: unknown) => rejected);

    expect(error).toBe(controller.signal.reason);
    expect(claude.calls).toHaveLength(1);
    expect(usage.entries.map((entry) => [entry.outcome, entry.reason, entry.sent])).toEqual([
      ["ok", undefined, true],
      ["failed", "stopped", false],
    ]);
  });
});
