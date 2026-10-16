import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backOfficeAccess } from "../admin/access";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateCoachConversations } from "../coach-conversations";
import { migrateProfiles } from "../profiles";
import type { AskingAdministrator, AssistantReply } from "./index";
import { createAssistantConversations, migrateAssistantConversations, purgeStaleAssistantConversations, type AssistantConversations } from "./conversations";

/** What the assistant was asked, per call. */
type Asked = { administrator: AskingAdministrator; input: { messages: { from: string; text: string }[] } };

describe.skipIf(!connectionString)("Back Office Assistant conversations (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let claire: AskingAdministrator;
  let paul: AskingAdministrator;
  let asked: Asked[];
  let assistantReply: (n: number) => AssistantReply;
  let conversations: AssistantConversations;
  let now: Date;

  async function administrator(email: string): Promise<AskingAdministrator> {
    const cookie = await signInWithMagicLink(testAuth, email);
    const id = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
    return { id, access: backOfficeAccess(["support"]) };
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateCoachConversations(database);
    await migrateAssistantConversations(database);
    await migrateAssistantConversations(database); // safe to run twice
    claire = await administrator("claire@jobbbox.fr");
    paul = await administrator("paul@jobbbox.fr");
    asked = [];
    assistantReply = (n) => ({
      ok: true,
      reply: `Réponse ${n}`,
      cost: { provider: "mistral", model: "mistral-large", inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0, eur: 0.002 },
    });
    now = new Date();
    const assistant = {
      async reply(asking: AskingAdministrator, input: unknown) {
        asked.push({ administrator: asking, input: input as Asked["input"] });
        return assistantReply(asked.length);
      },
    };
    conversations = createAssistantConversations(database, { assistant, now: () => now });
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("saves each exchange, so the conversation reopens as it was left; the assistant answers the saved conversation", async () => {
    const first = await conversations.send(claire, { message: "Quels sont les quotas Premium ?" });
    if (!first.ok) throw new Error("refused");
    const second = await conversations.send(claire, { conversationId: first.conversation.id, message: "Et en Standard ?" });

    expect(first.conversation.title).toBe("Quels sont les quotas Premium ?");
    expect(second).toMatchObject({ ok: true, reply: "Réponse 2", conversation: { id: first.conversation.id } });
    expect(asked[1]!.administrator).toBe(claire);
    expect(asked[1]!.input.messages).toEqual([
      { from: "administrator", text: "Quels sont les quotas Premium ?" },
      { from: "assistant", text: "Réponse 1" },
      { from: "administrator", text: "Et en Standard ?" },
    ]);
    expect(await conversations.open(claire.id, first.conversation.id)).toMatchObject({
      messages: [
        { from: "administrator", text: "Quels sont les quotas Premium ?" },
        { from: "assistant", text: "Réponse 1" },
        { from: "administrator", text: "Et en Standard ?" },
        { from: "assistant", text: "Réponse 2" },
      ],
    });
  });

  it("keeps them apart from Candidate Coach Conversations", async () => {
    await conversations.send(claire, { message: "Bonjour" });

    const { rows } = await database.query("SELECT count(*)::int AS n FROM coach_conversation");
    expect(rows[0].n).toBe(0);
  });

  it("each Administrator's conversations are theirs alone: another's is not found", async () => {
    const sent = await conversations.send(claire, { message: "Bonjour" });
    if (!sent.ok) throw new Error("refused");
    const id = sent.conversation.id;

    expect(await conversations.send(paul, { conversationId: id, message: "Et moi ?" })).toEqual({ ok: false, error: "not_found" });
    expect(await conversations.open(paul.id, id)).toBeNull();
    expect(await conversations.list(paul.id)).toEqual([]);
    expect(await conversations.rename(paul.id, id, "Volé")).toEqual({ ok: false, error: "not_found" });
    expect(await conversations.delete(paul.id, id)).toBe(false);

    expect(await conversations.rename(claire.id, id, "  Quotas  ")).toMatchObject({ ok: true, conversation: { title: "Quotas" } });
    expect((await conversations.list(claire.id)).map((conversation) => conversation.title)).toEqual(["Quotas"]);
    expect(await conversations.delete(claire.id, id)).toBe(true);
    expect(await conversations.list(claire.id)).toEqual([]);
  });

  it("saves nothing when the assistant cannot answer, and refuses bad input", async () => {
    assistantReply = () => ({ ok: false, error: "unavailable" });

    expect(await conversations.send(claire, { message: "Bonjour" })).toEqual({ ok: false, error: "unavailable" });
    expect(await conversations.send(claire, { message: "   " })).toEqual({ ok: false, error: "invalid" });
    expect(await conversations.send(claire, { conversationId: "not-a-uuid", message: "Bonjour" })).toEqual({ ok: false, error: "invalid" });
    expect(await conversations.list(claire.id)).toEqual([]);
  });

  it("goes with the Administrator's account, and is purged 12 months after its last message", async () => {
    const old = new Date("2025-01-10T10:00:00Z");
    now = old;
    await conversations.send(claire, { message: "Ancienne question" });
    now = new Date("2026-01-09T10:00:00Z");
    await conversations.send(claire, { message: "Récente" });
    await conversations.send(paul, { message: "Bonjour" });

    expect(await purgeStaleAssistantConversations(database, new Date("2026-01-10T10:00:00Z"))).toBe(1);
    expect((await conversations.list(claire.id)).map((conversation) => conversation.title)).toEqual(["Récente"]);

    await database.query("DELETE FROM candidate WHERE id = $1", [claire.id]);
    const { rows } = await database.query("SELECT count(*)::int AS n FROM back_office_assistant_message");
    expect(rows[0].n).toBe(2); // Paul's exchange only
  });
});
