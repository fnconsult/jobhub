/**
 * What each AI Coach reply cost in tokens, per message (#805, ADR-0086): every reply loaded on a page carries its ReplyCost,
 * the sum of all its AI calls as coach_message keeps it (#791), or null for a reply saved before. End to end on the fake
 * provider: the AI Coach with its Coach Actions (2 Tool rounds) and its Guardrails, saved and read back by Coach Conversations.
 */
import { createAiLayer, type TextInput } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeTurn } from "@jobhub/ai/testing";
import type { ReplyCost } from "@jobhub/shared";
import { coachConversationResponseSchema } from "@jobhub/shared/reads";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { agendaPage } from "../ai-activity";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createCandidateReads, type CandidateReadsDeps } from "../candidate-reads";
import { createCoach } from "../coach";
import { createCoachActions, defineCoachAction } from "../coach-actions";
import { createGuardrails, DEFAULT_GUARDRAIL_MESSAGES, GUARDRAIL_IDS, type GuardrailId, type GuardrailSetting } from "../guardrails";
import { migrateApplications } from "../applications";
import { migrateJobDigests } from "../job-digests";
import { migrateJobOffers } from "../job-offers";
import { migrateJobSearches } from "../job-searches";
import { createProfiles, migrateProfiles } from "../profiles";
import { createCoachConversations, migrateCoachConversations, type CoachConversations } from "./index";

const REPLY = "Votre profil vise la direction financière à Lyon.";

/** One reply's Turns: two Tool rounds, then the reply written, each with tokens of its own. */
const reply = (n: number): FakeTurn[] => [
  { toolCalls: [{ name: "lire_profil", arguments: {} }], usage: { inputTokens: 1_000 * n, outputTokens: 40, cachedInputTokens: 0 } },
  { toolCalls: [{ name: "lire_profil", arguments: {} }], usage: { inputTokens: 300 * n, outputTokens: 30, cachedInputTokens: 900 } },
  { text: `${REPLY} (${n})`, usage: { inputTokens: 200 * n, outputTokens: 120, cachedInputTokens: 1_100 } },
];

/** What a page is given over HTTP: JSON, then the shared read's schema. */
const overHttp = <S extends z.ZodType>(schema: S, answer: unknown): z.output<S> => schema.parse(JSON.parse(JSON.stringify(answer)));

describe.skipIf(!connectionString)("A Coach reply's cost, per message (#805; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let usage: ReturnType<typeof createMemoryUsageLog>;
  let conversations: CoachConversations;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    for (const migrate of [migrateProfiles, migrateJobOffers, migrateApplications, migrateJobSearches, migrateJobDigests, migrateCoachConversations]) await migrate(database);
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    marie = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;

    // The AI Coach's own calls on one fake, scripted reply after reply; the Guardrails' on another, which lets everything through.
    const coaching = createFakeProvider({ id: "mistral", turns: [...reply(1), ...reply(2), ...reply(3)] });
    const guarding = createFakeProvider({
      id: "anthropic",
      reply: (input: TextInput) => ((input.system ?? "").startsWith("Tu contrôles des données") ? '{"prompt_injection": false}' : "{}"),
      usage: { inputTokens: 50, outputTokens: 5 },
    });
    usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [coaching, guarding], routes: { coaching: "mistral", guardrail: "anthropic" }, usage });
    const coach = createCoach({
      ai,
      playbooks: { served: async () => ({ coreDigest: null, sources: null, playbooks: [] }) },
      context: async () => "Le candidat s'appelle Marie (prénom seulement).",
      coachActions: createCoachActions({
        catalog: [
          defineCoachAction({
            name: "lire_profil",
            description: "Lit le profil du candidat.",
            schema: z.object({}),
            group: "profile",
            kind: "read",
            copiesText: false,
            run: async () => ({ ok: true, data: { headline: "Directrice financière" } }),
          }),
        ],
        settings: async () => ({ enabled: true, maxRounds: 2 }),
        externalApis: { record: () => {} },
      }),
      guardrails: createGuardrails({
        ai,
        config: { current: async () => ({ settings: Object.fromEntries(GUARDRAIL_IDS.map((id) => [id, "block"])) as Record<GuardrailId, GuardrailSetting>, messages: DEFAULT_GUARDRAIL_MESSAGES }) },
        triggers: { record: () => {} },
      }),
      warn: () => {},
    });
    conversations = createCoachConversations(database, { coach, profiles: createProfiles(database) });
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  /** Sends `message` in the Agenda's conversation; what AI Usage recorded for its reply, summed as its ReplyCost. */
  async function send(message: string): Promise<{ sent: ReplyCost | null; summed: ReplyCost }> {
    const before = usage.entries.length;
    const result = await conversations.send(marie, { subject: { kind: "menu", id: "agenda" }, message });
    if (!result.ok) throw new Error(`refused: ${result.error}`);
    const entries = usage.entries.slice(before);
    const turns = entries.filter((entry) => entry.task === "coaching");
    return {
      sent: result.sent,
      summed: {
        calls: entries.length,
        turns: turns.length,
        rounds: 2,
        inputTokens: entries.reduce((sum, entry) => sum + entry.inputTokens + (entry.cachedInputTokens ?? 0), 0),
        cachedInputTokens: entries.reduce((sum, entry) => sum + (entry.cachedInputTokens ?? 0), 0),
        outputTokens: entries.reduce((sum, entry) => sum + entry.outputTokens, 0),
      },
    };
  }

  it("is the sum of all its AI calls: its 2 Tool rounds, the reply written and every Guardrail check", async () => {
    const { sent, summed } = await send("Que dit mon profil ?");

    expect(usage.entries.some((entry) => entry.task === "guardrail")).toBe(true);
    expect(summed).toMatchObject({ turns: 3, inputTokens: 1_000 + 300 + 900 + 200 + 1_100 + 50 * (summed.calls - 3), cachedInputTokens: 2_000 });
    expect(sent).toEqual(summed);
  });

  it("comes with each reply of a conversation loaded on a page: 2 ReplyCost for the replies saved since #791, null for the one before", async () => {
    await send("Première question");
    const { summed: second } = await send("Deuxième question");
    const { summed: third } = await send("Troisième question");
    // The first reply as saved before #791: no AI call kept with it.
    await database.query(
      `UPDATE coach_message SET ai_call_ids = NULL, ai_turn_ids = NULL, tool_rounds = NULL, tool_names = NULL
        WHERE seq = (SELECT min(seq) FROM coach_message WHERE author = 'coach')`,
    );
    const expected = [null, second, third];

    // GET /api/coach/conversations/[id]
    const id = (await conversations.list(marie))[0]!.id;
    const reads = createCandidateReads({ coachConversations: conversations } as unknown as CandidateReadsDeps);
    const { conversation } = overHttp(coachConversationResponseSchema, await reads.coachConversation(marie, id));
    expect(conversation!.messages.filter((message) => message.from === "coach").map((message) => message.sent)).toEqual(expected);
    expect(conversation!.messages.filter((message) => message.from === "candidate").every((message) => !("sent" in message))).toBe(true);

    // AI Activity's `coach_reply` elements, the Agenda's page here
    const elements = await agendaPage({ jobOffers: { provenances: async () => new Map() }, coachReplies: conversations }, marie);
    expect(elements.map((element) => element.sent)).toEqual(expected);
  });

  it("never sends the browser the Tools' internal names with it, nor with the Context bar's « Cette réponse », nor any euro", async () => {
    const { summed } = await send("Que dit mon profil ?");
    const id = (await conversations.list(marie))[0]!.id;
    const reads = createCandidateReads({ coachConversations: conversations } as unknown as CandidateReadsDeps);
    const read = await reads.coachConversation(marie, id);
    const elements = await agendaPage({ jobOffers: { provenances: async () => new Map() }, coachReplies: conversations }, marie);
    const costs = [read!.conversation!.messages[1]!.sent, read!.conversation!.context.reply, elements[0]!.sent];

    expect(costs).toEqual([summed, summed, summed]);
    expect(JSON.stringify(costs)).not.toMatch(/lire_profil|tools|€|eur\b/i);
  });
});
