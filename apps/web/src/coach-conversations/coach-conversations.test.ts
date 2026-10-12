import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import type { CoachReply } from "../coach";
import { createProfiles, migrateProfiles } from "../profiles";
import { createCoachConversations, migrateCoachConversations, purgeStaleCoachConversations, type CoachConversations } from "./index";

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

/** What the AI Coach was asked, per call: the messages and what was in view. */
type Asked = { candidateId: string; input: { messages: { from: string; text: string }[]; focus?: unknown } };

describe.skipIf(!connectionString)("Coach Conversations (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let jean: string;
  let asked: Asked[];
  let coachReply: (n: number) => CoachReply;
  let conversations: CoachConversations;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateCoachConversations(database);
    await migrateCoachConversations(database); // safe to run twice
    marie = await candidate("marie.dupont@example.fr");
    jean = await candidate("jean.martin@example.fr");
    asked = [];
    coachReply = (n) => ({ ok: true, reply: `Réponse ${n}` });
    const coach = {
      async reply(candidateId: string, input: unknown) {
        asked.push({ candidateId, input: input as Asked["input"] });
        return coachReply(asked.length);
      },
    };
    conversations = createCoachConversations(database, { coach, profiles: createProfiles(database) });
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("saves each exchange, so the conversation reopens as it was left", async () => {
    const first = await conversations.send(marie, { message: "Bonjour" });
    if (!first.ok) throw new Error("refused");
    const second = await conversations.send(marie, { conversationId: first.conversation.id, message: "Par où commencer ?" });

    expect(second).toMatchObject({ ok: true, reply: "Réponse 2", conversation: { id: first.conversation.id } });
    expect(await conversations.open(marie, first.conversation.id)).toMatchObject({
      id: first.conversation.id,
      messages: [
        { from: "candidate", text: "Bonjour" },
        { from: "coach", text: "Réponse 1" },
        { from: "candidate", text: "Par où commencer ?" },
        { from: "coach", text: "Réponse 2" },
      ],
    });
    // The AI Coach answers the saved conversation, not what the browser claims it was.
    expect(asked[1]!.input.messages).toEqual([
      { from: "candidate", text: "Bonjour" },
      { from: "coach", text: "Réponse 1" },
      { from: "candidate", text: "Par où commencer ?" },
    ]);
  });

  it("keeps several conversations per Candidate, most recently active first, each attached to the Profile in view when it started", async () => {
    const profile = await createProfiles(database).create(marie, { masterCv, searchCriteria: { targetRole: "Directrice financière", location: "Lyon" } });
    if (!profile.ok) throw new Error("fixture refused");
    const onProfile = await conversations.send(marie, { message: "Mon CV est-il bon ?", focus: { kind: "profile", id: profile.profile.id } });
    const elsewhere = await conversations.send(marie, { message: "Comment préparer un entretien ?" });
    if (!onProfile.ok || !elsewhere.ok) throw new Error("refused");
    // Talking on another page later does not move the conversation to it.
    await conversations.send(marie, { conversationId: onProfile.conversation.id, message: "Et ma formation ?" });

    const list = await conversations.list(marie);

    expect(list).toEqual([
      { id: onProfile.conversation.id, title: "Mon CV est-il bon ?", profile: { id: profile.profile.id, name: "Directrice financière" }, lastMessageAt: expect.any(Date) },
      { id: elsewhere.conversation.id, title: "Comment préparer un entretien ?", profile: null, lastMessageAt: expect.any(Date) },
    ]);
    expect(onProfile.conversation.profile).toEqual({ id: profile.profile.id, name: "Directrice financière" });
    expect(asked[0]!.input.focus).toEqual({ kind: "profile", id: profile.profile.id });
    expect(await conversations.list(jean)).toEqual([]);
  });

  it("does not attach another Candidate's Profile, even when its id is sent", async () => {
    const profile = await createProfiles(database).create(marie, { masterCv, searchCriteria: { targetRole: "Directrice financière", location: "Lyon" } });
    if (!profile.ok) throw new Error("fixture refused");

    const sent = await conversations.send(jean, { message: "Et ce profil ?", focus: { kind: "profile", id: profile.profile.id } });

    expect(sent).toMatchObject({ ok: true, conversation: { profile: null } });
  });

  it("never lets another Candidate read or continue a conversation", async () => {
    const sent = await conversations.send(marie, { message: "Bonjour" });
    if (!sent.ok) throw new Error("refused");

    expect(await conversations.open(jean, sent.conversation.id)).toBeNull();
    expect(await conversations.send(jean, { conversationId: sent.conversation.id, message: "Je lis ?" })).toEqual({ ok: false, error: "not_found" });
    expect(await conversations.open(marie, "not-a-uuid")).toBeNull();
    expect(asked).toHaveLength(1);
  });

  it("saves nothing when the AI Coach cannot answer, so the Candidate can send again", async () => {
    const sent = await conversations.send(marie, { message: "Bonjour" });
    if (!sent.ok) throw new Error("refused");
    coachReply = () => ({ ok: false, error: "unavailable" });

    expect(await conversations.send(marie, { conversationId: sent.conversation.id, message: "Encore là ?" })).toEqual({ ok: false, error: "unavailable" });
    expect(await conversations.send(marie, { message: "Une autre question" })).toEqual({ ok: false, error: "unavailable" });

    expect((await conversations.open(marie, sent.conversation.id))?.messages).toHaveLength(2);
    expect(await conversations.list(marie)).toHaveLength(1);
  });

  it("refuses an empty or overlong message, or a malformed conversation id, without asking the AI Coach", async () => {
    expect(await conversations.send(marie, { message: "   " })).toEqual({ ok: false, error: "invalid" });
    expect(await conversations.send(marie, { message: "x".repeat(5001) })).toEqual({ ok: false, error: "invalid" });
    expect(await conversations.send(marie, { conversationId: "42", message: "Bonjour" })).toEqual({ ok: false, error: "invalid" });
    expect(await conversations.send(marie, "Bonjour")).toEqual({ ok: false, error: "invalid" });
    expect(asked).toHaveLength(0);
  });

  it("lets the Candidate rename a conversation, but not with an empty or overlong name, nor someone else's", async () => {
    const sent = await conversations.send(marie, { message: "Bonjour" });
    if (!sent.ok) throw new Error("refused");
    const id = sent.conversation.id;

    expect(await conversations.rename(marie, id, "  Préparer l'entretien chez Seb  ")).toMatchObject({ ok: true, conversation: { id, title: "Préparer l'entretien chez Seb" } });
    expect(await conversations.rename(marie, id, "   ")).toEqual({ ok: false, error: "invalid" });
    expect(await conversations.rename(marie, id, "x".repeat(81))).toEqual({ ok: false, error: "invalid" });
    expect(await conversations.rename(marie, id, 42)).toEqual({ ok: false, error: "invalid" });
    expect(await conversations.rename(jean, id, "À moi")).toEqual({ ok: false, error: "not_found" });

    expect(await conversations.list(marie)).toMatchObject([{ id, title: "Préparer l'entretien chez Seb" }]);
  });

  it("lets the Candidate delete a conversation with its messages, but not someone else's", async () => {
    const kept = await conversations.send(marie, { message: "À garder" });
    const deleted = await conversations.send(marie, { message: "À supprimer" });
    if (!kept.ok || !deleted.ok) throw new Error("refused");

    expect(await conversations.delete(jean, deleted.conversation.id)).toBe(false);
    expect(await conversations.delete(marie, deleted.conversation.id)).toBe(true);
    expect(await conversations.delete(marie, deleted.conversation.id)).toBe(false);
    expect(await conversations.delete(marie, "not-a-uuid")).toBe(false);

    expect(await conversations.open(marie, deleted.conversation.id)).toBeNull();
    expect(await conversations.list(marie)).toMatchObject([{ id: kept.conversation.id }]);
    expect(await conversations.send(marie, { conversationId: deleted.conversation.id, message: "Encore ?" })).toEqual({ ok: false, error: "not_found" });
  });

  it("keeps a conversation 12 months after its last message, then the purge deletes it", async () => {
    const sent = await conversations.send(marie, { message: "Bonjour" });
    if (!sent.ok) throw new Error("refused");
    const inMonths = (months: number, days = 0) => {
      const at = new Date(sent.conversation.lastMessageAt);
      at.setMonth(at.getMonth() + months);
      at.setDate(at.getDate() + days);
      return at;
    };

    expect(await purgeStaleCoachConversations(database, inMonths(11, 27))).toBe(0);
    expect(await conversations.open(marie, sent.conversation.id)).not.toBeNull();

    expect(await purgeStaleCoachConversations(database, inMonths(12, 1))).toBe(1);
    expect(await conversations.open(marie, sent.conversation.id)).toBeNull();
    expect(await conversations.list(marie)).toEqual([]);
  });

  it("names a new conversation after the start of its first message", async () => {
    const sent = await conversations.send(marie, { message: `Bonjour,\n\n${"je cherche un poste de directrice financière ".repeat(4)}` });

    if (!sent.ok) throw new Error("refused");
    expect(sent.conversation.title).toMatch(/^Bonjour, je cherche un poste de directrice financière je cherche.*…$/);
    expect(sent.conversation.title.length).toBeLessThanOrEqual(80);
  });
});
