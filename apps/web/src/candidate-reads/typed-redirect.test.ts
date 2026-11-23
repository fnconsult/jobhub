import { coachConversationResponseSchema } from "@jobhub/shared/reads";
import { describe, expect, it, vi } from "vitest";
import { createCandidateReads, type CandidateReadsDeps } from "./index";

/**
 * A reply's Typed redirect (ADR-0114) on `GET /api/coach/conversations/:id` and the Subject's conversation, without a
 * database: the link under the reply is still there when the conversation is opened again.
 */
const REDIRECT = { page: "Profil Directrice financière", section: null, object: "Nom du profil", href: "/profils/p1" };
const CONVERSATION = {
  id: "conv-1",
  title: "Renommer mon profil",
  subject: { kind: "menu", id: "applications", name: "Mes candidatures" },
  profile: null,
  lastMessageAt: new Date("2026-11-04T09:00:00.000Z"),
  aiDisclosure: true,
  messages: [
    { from: "candidate", text: "Renomme mon profil." },
    { from: "coach", text: "Renommez-le vous-même sur sa page.", at: "2026-11-04T09:00:00.000Z", provenance: null, redirect: REDIRECT },
    { from: "candidate", text: "Merci." },
    { from: "coach", text: "Avec plaisir.", at: "2026-11-04T09:00:00.000Z", provenance: null },
  ],
  context: { messages: 4, tokens: 10 },
};

const reads = () =>
  createCandidateReads({
    coachConversations: { open: vi.fn(async () => CONVERSATION), ofSubject: vi.fn(async () => ({ ok: true, conversation: CONVERSATION })), list: vi.fn() },
  } as unknown as CandidateReadsDeps);

/** What the app reads: the answer as it crosses HTTP (JSON), parsed with its shared schema. */
const overHttp = (answer: unknown) => coachConversationResponseSchema.parse(JSON.parse(JSON.stringify(answer)));

describe("A Coach Conversation opened again keeps each reply's Typed redirect (ADR-0114)", () => {
  it("gives the reply its Typed redirect, the conversation opened by its id and as the Subject's", async () => {
    for (const read of [await reads().coachConversation("candidate-1", "conv-1"), await reads().coachConversationOfSubject("candidate-1", { kind: "menu", id: "applications" })]) {
      const messages = overHttp(read).conversation!.messages;
      expect(messages[1]).toMatchObject({ from: "coach", redirect: REDIRECT });
      expect(messages[3]).not.toHaveProperty("redirect");
      expect(messages[0]).not.toHaveProperty("redirect");
    }
  });

  it("refuses, in the shared type, a kept link that is not one of Jobbbox's pages", () => {
    const conversation = { ...CONVERSATION, lastMessageAt: CONVERSATION.lastMessageAt.toISOString(), messages: [{ from: "coach", text: "Voir ici.", redirect: { ...REDIRECT, href: "//example.org" } }] };
    expect(coachConversationResponseSchema.safeParse({ conversation }).success).toBe(false);
  });
});
