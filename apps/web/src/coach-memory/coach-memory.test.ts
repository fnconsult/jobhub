import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import type { CoachConversation } from "../coach-conversations";
import { servedTasks, taskAgent } from "../task-playbooks/test-support";
import { createCoachMemory, MAX_ITEMS, migrateCoachMemory, type CoachMemory } from "./index";

const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

describe.skipIf(!connectionString)("Coach Memory (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let jean: string;
  let provider: FakeProvider;
  /** What the AI Coach answers when asked what to remember. */
  let aiAnswer: string;
  let memory: CoachMemory;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  /** Marie's conversation with the AI Coach; nobody else can open it. */
  function conversationOf(candidateId: string, conversationId: string): CoachConversation | null {
    if (candidateId !== marie || conversationId !== CONVERSATION_ID) return null;
    return {
      id: CONVERSATION_ID,
      title: "Ma recherche",
      subject: null,
      profile: null,
      lastMessageAt: new Date(),
      aiDisclosure: true,
      context: { messages: 4, tokens: 0 },
      messages: [
        { from: "candidate", text: "Je veux un poste de DAF à Lyon, pas plus de 2 jours de déplacement par mois." },
        { from: "coach", text: "Entendu. Visez-vous l'industrie ?" },
        { from: "candidate", text: "Oui, j'ai décidé de ne plus postuler dans la banque." },
      ],
    };
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateCoachMemory(database);
    await migrateCoachMemory(database); // safe to run twice
    marie = await candidate("marie.dupont@example.fr");
    jean = await candidate("jean.martin@example.fr");
    aiAnswer = JSON.stringify({
      items: [
        { kind: "goal", text: "Poste de DAF à Lyon" },
        { kind: "constraint", text: "Pas plus de 2 jours de déplacement par mois" },
        { kind: "decision", text: "Ne plus postuler dans la banque" },
      ],
    });
    provider = createFakeProvider({ id: "mistral", reply: () => aiAnswer });
    const ai = createAiLayer({ providers: [provider], routes: { coaching: "mistral" }, usage: createMemoryUsageLog() });
    memory = createCoachMemory(database, { ai, conversations: { open: async (candidateId, id) => conversationOf(candidateId, id) } });
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("proposes the key facts of a conversation (goals, constraints, decisions) but saves none of them", async () => {
    const proposed = await memory.propose(marie, CONVERSATION_ID);

    expect(proposed).toEqual({
      ok: true,
      proposals: [
        { kind: "goal", text: "Poste de DAF à Lyon" },
        { kind: "constraint", text: "Pas plus de 2 jours de déplacement par mois" },
        { kind: "decision", text: "Ne plus postuler dans la banque" },
      ],
    });
    expect(provider.calls[0]!.messages.at(-1)!.content).toContain("pas plus de 2 jours de déplacement");
    expect(await memory.list(marie)).toEqual([]);
  });

  it("asks with the coach-memory task Playbook's version 1 word for word as before, then no personal data and the reply's shape (ADR-0026)", async () => {
    await memory.propose(marie, CONVERSATION_ID);

    expect(provider.calls[0]!.system).toBe(`Tu es le coach Jobbbox. Tu relis une conversation avec un candidat et tu proposes les faits clés à retenir pour les prochaines conversations : ses objectifs (goal), ses contraintes (constraint) et ses décisions (decision).
Règles :
- Uniquement ce que le candidat a dit lui-même. N'invente rien, ne déduis rien.
- Une phrase courte par fait, dans la langue du candidat.
- Jamais de nom, d'e-mail, de téléphone ni d'adresse.
Réponds uniquement avec un objet JSON : {"items": [{"kind": "goal" | "constraint" | "decision", "text": "le fait"}]}. Aucun fait à retenir : {"items": []}.`);
  });

  it("asks with the served task Playbook's instructions, on its Playbook Agent, never without the rule on personal data (ADR-0026)", async () => {
    const claude = createFakeProvider({ id: "anthropic", reply: () => aiAnswer });
    const ai = createAiLayer({ providers: [provider, claude], routes: { coaching: "mistral" }, usage: createMemoryUsageLog() });
    const served = createCoachMemory(database, {
      ai,
      conversations: { open: async (candidateId, id) => conversationOf(candidateId, id) },
      taskPlaybooks: servedTasks({ "coach-memory": { content: "Retiens les objectifs seulement.", agent: taskAgent("anthropic", null, "low") } }),
    });

    expect(await served.propose(marie, CONVERSATION_ID)).toMatchObject({ ok: true });

    expect(provider.calls).toHaveLength(0);
    expect(claude.calls[0]).toMatchObject({ effort: "low" });
    expect(claude.calls[0]!.system).toMatch(/^Retiens les objectifs seulement\.\n- Jamais de nom, d'e-mail, de téléphone ni d'adresse\.\nRéponds uniquement avec un objet JSON/);
  });

  it("saves an item only once the Candidate confirms it, in their Coach Memory alone", async () => {
    const confirmed = await memory.confirm(marie, { kind: "goal", text: "  Poste de DAF à Lyon " });

    expect(confirmed).toEqual({ ok: true, item: { id: expect.any(String), kind: "goal", text: "Poste de DAF à Lyon", updatedAt: expect.any(Date) } });
    expect(await memory.list(marie)).toEqual([{ id: expect.any(String), kind: "goal", text: "Poste de DAF à Lyon", updatedAt: expect.any(Date) }]);
    expect(await memory.list(jean)).toEqual([]);
  });

  it("refuses an empty, overlong or unknown kind of item", async () => {
    expect(await memory.confirm(marie, { kind: "goal", text: "   " })).toEqual({ ok: false, error: "invalid" });
    expect(await memory.confirm(marie, { kind: "goal", text: "x".repeat(301) })).toEqual({ ok: false, error: "invalid" });
    expect(await memory.confirm(marie, { kind: "wish", text: "Lyon" })).toEqual({ ok: false, error: "invalid" });
    expect(await memory.confirm(marie, null)).toEqual({ ok: false, error: "invalid" });
    expect(await memory.list(marie)).toEqual([]);
  });

  it("does not propose again what the Coach Memory already holds, and keeps one copy when confirmed twice", async () => {
    await memory.confirm(marie, { kind: "goal", text: "Poste de DAF à Lyon" });
    await memory.confirm(marie, { kind: "goal", text: "poste de DAF  à Lyon" });

    const proposed = await memory.propose(marie, CONVERSATION_ID);

    expect(proposed).toMatchObject({ ok: true, proposals: [{ kind: "constraint" }, { kind: "decision" }] });
    expect(provider.calls[0]!.messages.at(-1)!.content).toContain("Poste de DAF à Lyon");
    expect(await memory.list(marie)).toHaveLength(1);
  });

  it("never proposes from another Candidate's conversation, nor asks the AI Coach about it", async () => {
    expect(await memory.propose(jean, CONVERSATION_ID)).toEqual({ ok: false, error: "not_found" });
    expect(provider.calls).toEqual([]);
  });

  it("says the AI Coach is unavailable when its answer cannot be read, and keeps only well-formed proposals otherwise", async () => {
    aiAnswer = "Je retiens que vous visez Lyon.";
    expect(await memory.propose(marie, CONVERSATION_ID)).toEqual({ ok: false, error: "unavailable" });

    aiAnswer = JSON.stringify({ items: [{ kind: "wish", text: "Lyon" }, { kind: "goal", text: "" }, { kind: "goal", text: "Poste de DAF à Lyon" }, { kind: "goal", text: "Poste de DAF à Lyon" }] });
    expect(await memory.propose(marie, CONVERSATION_ID)).toEqual({ ok: true, proposals: [{ kind: "goal", text: "Poste de DAF à Lyon" }] });
    expect(await memory.list(marie)).toEqual([]);
  });

  it(`refuses a new item once the Coach Memory holds ${MAX_ITEMS}, until the Candidate deletes one`, async () => {
    for (let n = 1; n <= MAX_ITEMS; n++) await memory.confirm(marie, { kind: "goal", text: `Objectif ${n}` });

    expect(await memory.confirm(marie, { kind: "goal", text: "Un de trop" })).toEqual({ ok: false, error: "full" });
    const [first] = await memory.list(marie);
    await memory.delete(marie, first!.id);
    expect(await memory.confirm(marie, { kind: "goal", text: "Un de trop" })).toMatchObject({ ok: true });
  });

  it("lets the Candidate edit an item's words and kind, but not empty, overlong or someone else's", async () => {
    const saved = await memory.confirm(marie, { kind: "goal", text: "Poste de DAF à Lyon" });
    if (!saved.ok) throw new Error("refused");

    const edited = await memory.edit(marie, saved.item.id, { kind: "decision", text: "Poste de DAF à Lyon ou Grenoble" });

    expect(edited).toEqual({ ok: true, item: { id: saved.item.id, kind: "decision", text: "Poste de DAF à Lyon ou Grenoble", updatedAt: expect.any(Date) } });
    expect(await memory.edit(marie, saved.item.id, { kind: "goal", text: "  " })).toEqual({ ok: false, error: "invalid" });
    expect(await memory.edit(marie, saved.item.id, { kind: "goal", text: "x".repeat(301) })).toEqual({ ok: false, error: "invalid" });
    expect(await memory.edit(marie, saved.item.id, { kind: "wish", text: "Lyon" })).toEqual({ ok: false, error: "invalid" });
    expect(await memory.edit(jean, saved.item.id, { kind: "goal", text: "Je modifie ?" })).toEqual({ ok: false, error: "not_found" });
    expect(await memory.edit(marie, "not-a-uuid", { kind: "goal", text: "Lyon" })).toEqual({ ok: false, error: "not_found" });
    expect(await memory.list(marie)).toMatchObject([{ kind: "decision", text: "Poste de DAF à Lyon ou Grenoble" }]);
  });

  it("lets the Candidate delete an item, but not someone else's", async () => {
    const kept = await memory.confirm(marie, { kind: "goal", text: "Poste de DAF à Lyon" });
    const gone = await memory.confirm(marie, { kind: "decision", text: "Ne plus postuler dans la banque" });
    if (!kept.ok || !gone.ok) throw new Error("refused");

    expect(await memory.delete(jean, gone.item.id)).toBe(false);
    expect(await memory.delete(marie, gone.item.id)).toBe(true);
    expect(await memory.delete(marie, gone.item.id)).toBe(false);
    expect(await memory.delete(marie, "not-a-uuid")).toBe(false);
    expect(await memory.list(marie)).toEqual([kept.item]);
  });
});
