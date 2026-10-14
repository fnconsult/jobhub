import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import type { CoachConversation } from "../coach-conversations";
import { createCoachMemory, migrateCoachMemory, type CoachMemory } from "./index";

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
      profile: null,
      lastMessageAt: new Date(),
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

  it("saves an item only once the Candidate confirms it, in their Coach Memory alone", async () => {
    const confirmed = await memory.confirm(marie, { kind: "goal", text: "  Poste de DAF à Lyon " });

    expect(confirmed).toEqual({ ok: true, item: { id: expect.any(String), kind: "goal", text: "Poste de DAF à Lyon", updatedAt: expect.any(Date) } });
    expect(await memory.list(marie)).toEqual([{ id: expect.any(String), kind: "goal", text: "Poste de DAF à Lyon", updatedAt: expect.any(Date) }]);
    expect(await memory.list(jean)).toEqual([]);
  });

  it("does not propose again what the Coach Memory already holds, and keeps one copy when confirmed twice", async () => {
    await memory.confirm(marie, { kind: "goal", text: "Poste de DAF à Lyon" });
    await memory.confirm(marie, { kind: "goal", text: "poste de DAF  à Lyon" });

    const proposed = await memory.propose(marie, CONVERSATION_ID);

    expect(proposed).toMatchObject({ ok: true, proposals: [{ kind: "constraint" }, { kind: "decision" }] });
    expect(provider.calls[0]!.messages.at(-1)!.content).toContain("Poste de DAF à Lyon");
    expect(await memory.list(marie)).toHaveLength(1);
  });
});
