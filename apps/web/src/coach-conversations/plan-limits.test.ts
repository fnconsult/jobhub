import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateApplications } from "../applications";
import { STARTING_PLAN_QUOTAS } from "../billing";
import { connectionString, startTestBilling, type TestBilling } from "../billing/test-support";
import { createCoach, estimateTokens } from "../coach";
import { migrateJobDigests } from "../job-digests";
import { migrateJobOffers } from "../job-offers";
import { migrateJobSearches } from "../job-searches";
import { createProfiles, migrateProfiles } from "../profiles";
import { createCoachConversations, migrateCoachConversations, type CoachConversations } from "./index";

/** What the AI Coach knows of the Candidate, longer than any ceiling here: told up to the room its Plan leaves (as an Eval Run's context is). */
const WORKSPACE = `Début du contexte. ${"Expérience de direction financière. ".repeat(2_000)}Fin du contexte.`;

/**
 * The Coach context limits of a Plan, from the Quotas page to the AI Coach (ADR-0078, #731): the Administrator changes them,
 * and the next message reads what they now allow, with the real AI Coach, Coach Conversations and the Plan in the database.
 */
describe.skipIf(!connectionString)("Coach context limits from the Plan to the AI Coach (needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  let provider: FakeProvider;
  let conversations: CoachConversations;
  let marie: string;

  beforeEach(async () => {
    t = await startTestBilling();
    for (const migrate of [migrateProfiles, migrateJobOffers, migrateApplications, migrateJobSearches, migrateJobDigests, migrateCoachConversations]) await migrate(t.database);
    provider = createFakeProvider({ id: "mistral", reply: "Bonne question." });
    const ai = createAiLayer({ providers: [provider], routes: { coaching: "mistral" }, usage: createMemoryUsageLog() });
    const coach = createCoach({
      ai,
      playbooks: { served: async () => ({ coreDigest: null, sources: null, playbooks: [] }) },
      context: async (_candidateId, _focus, maxTokens) => (Number.isFinite(maxTokens) ? WORKSPACE.slice(0, Math.max(0, maxTokens) * 4) : WORKSPACE),
    });
    conversations = createCoachConversations(t.database, { coach, profiles: createProfiles(t.database), billing: t.billing });
    marie = (await t.signUp("marie.dupont@example.fr")).id;
  });
  afterEach(async () => {
    await t.stop();
  });

  /** Marie's conversation after `count` exchanges on her Plan as it is. */
  async function exchanges(count: number, id?: string): Promise<string> {
    for (let n = 1; n <= count; n += 1) {
      const sent = await conversations.send(marie, { ...(id ? { conversationId: id } : {}), message: `Question ${n}` });
      if (!sent.ok) throw new Error(`refused: ${sent.error}`);
      id = sent.conversation.id;
    }
    return id!;
  }
  const read = () => provider.calls.at(-1)!.messages.length;
  const told = () => estimateTokens(provider.calls.at(-1)!.system ?? "");

  it("reads 40 messages and fits 12 000 jetons on a Plan with no limits stored, as before", async () => {
    await exchanges(25);

    expect(read()).toBe(39);
    expect(told()).toBeLessThanOrEqual(12_000);
    expect(told()).toBeGreaterThan(11_000);
  });

  it("reads fewer messages on the next message once coachContextMessages is lowered, all of them once unlimited", async () => {
    const id = await exchanges(25);

    await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, coachContextMessages: 6, coachContextTokens: 12_000 });
    await exchanges(1, id);
    expect(read()).toBe(5);

    await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, coachContextMessages: null, coachContextTokens: 12_000 });
    await exchanges(1, id);
    expect(read()).toBe(2 * 27 - 1);
    // The conversation itself is kept whole all along.
    expect((await conversations.open(marie, id))!.context).toMatchObject({ messages: 2 * 27, limits: { coachContextMessages: null, coachContextTokens: 12_000 } });
  });

  it("fits a smaller context on the next message once coachContextTokens is lowered, everything once unlimited", async () => {
    const id = await exchanges(1);

    await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, coachContextMessages: 40, coachContextTokens: 3_000 });
    const lowered = await conversations.send(marie, { conversationId: id, message: "Et maintenant ?" });
    expect(told()).toBeLessThanOrEqual(3_000);
    expect(told()).toBeGreaterThan(2_500);
    expect(lowered).toMatchObject({ ok: true, context: { limits: { coachContextTokens: 3_000 } } });

    await t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, coachContextMessages: 40, coachContextTokens: null });
    const unlimited = await conversations.send(marie, { conversationId: id, message: "Et sans plafond ?" });
    expect(provider.calls.at(-1)!.system).toContain("Fin du contexte.");
    if (!unlimited.ok) throw new Error("refused");
    expect(unlimited.context.tokens).toBeGreaterThan(estimateTokens(WORKSPACE));
    expect(unlimited.context.split).toMatchObject({ profile: estimateTokens(WORKSPACE) });
  });
});
