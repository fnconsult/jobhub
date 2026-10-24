import type { CandidateIdentity } from "@jobhub/ai";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { createUnansweredQuestions, migrateUnansweredQuestions, purgeUnansweredQuestions, type NoticedReply, type UnansweredQuestions } from "./index";

const connectionString = process.env.DATABASE_URL;

/** Marie's identity, as the AI layer knows it: what Redaction takes out. */
const MARIE: CandidateIdentity = { fullName: "Marie Dupont", firstName: "Marie", lastName: "Dupont", email: "marie.dupont@example.fr", phone: "06 12 34 56 78" };

/** A question the help has no article for, about using Jobbbox, that the AI Coach answered. */
const QUOTA = "Pourquoi suis-je bloqué à cinq analyses ?";
const replied = (question: string, more: Partial<NoticedReply> = {}): NoticedReply => ({
  question,
  reply: { text: "Votre quota se renouvelle chaque lundi.", outcome: "replied", aboutJobbbox: true },
  route: "/candidatures/0b6c2f1e-1111-4111-8111-111111111111/documents",
  language: "fr",
  ...more,
});

describe.skipIf(!connectionString)("Unanswered Questions (#344, ADR-0035; needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;
  let questions: UnansweredQuestions;
  let now: Date;

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_unanswered_questions");
    database = throwaway.pool;
    await migrateUnansweredQuestions(database);
    await migrateUnansweredQuestions(database); // safe to run twice
    now = new Date("2026-10-24T10:00:00Z");
    questions = createUnansweredQuestions(database, { identityOf: async (candidateId) => (candidateId === "marie" ? MARIE : null), now: () => now });
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  describe("recorded after an AI Coach reply", () => {
    it("records a question no Help Article matched and that the AI Coach marked as about using Jobbbox, with its page as a route pattern", async () => {
      expect(await questions.notice("marie", replied(QUOTA))).toBe(true);

      expect(await questions.open()).toEqual([
        {
          id: expect.any(String),
          question: QUOTA,
          answer: "Votre quota se renouvelle chaque lundi.",
          route: "/candidatures/[id]/documents",
          language: "fr",
          count: 1,
          firstAskedAt: now,
          lastAskedAt: now,
          status: "open",
        },
      ]);
    });

    it("counts the same question asked again, written differently, keeping when it was first and last asked", async () => {
      await questions.notice("marie", replied(QUOTA));
      const first = now;
      now = new Date("2026-10-25T09:00:00Z");
      await questions.notice("jean", replied("cinq analyses : pourquoi suis-je BLOQUÉ"));

      expect(await questions.open()).toEqual([expect.objectContaining({ question: QUOTA, count: 2, firstAskedAt: first, lastAskedAt: now })]);
    });

    it("keeps apart the same question asked from another page or in another language", async () => {
      await questions.notice("marie", replied(QUOTA));
      await questions.notice("marie", replied(QUOTA, { route: "/" }));
      await questions.notice("marie", replied(QUOTA, { language: "en" }));

      expect((await questions.open()).map((each) => [each.route, each.language, each.count])).toEqual([
        ["/", "fr", 1],
        ["/candidatures/[id]/documents", "en", 1],
        ["/candidatures/[id]/documents", "fr", 1],
      ]);
    });

    it.each([
      ["job-search advice", replied("Réécris mon CV", { reply: { text: "Voici votre CV.", outcome: "replied", aboutJobbbox: false } })],
      ["a reply that did not say", replied(QUOTA, { reply: { text: "Votre quota se renouvelle chaque lundi.", outcome: "replied" } })],
      ["a question a Help Article matches", replied("Quand mon quota se renouvelle-t-il ?")],
      ["a blocked message", replied(QUOTA, { reply: { text: "Message du garde-fou.", outcome: "blocked_message", aboutJobbbox: true } })],
      ["a blocked reply", replied(QUOTA, { reply: { text: "Message du garde-fou.", outcome: "blocked_reply", aboutJobbbox: true } })],
      ["the distress message", replied(QUOTA, { reply: { text: "Message de détresse.", outcome: "distress", aboutJobbbox: true } })],
      ["a question of stop-words alone", replied("Et pourquoi ?")],
    ])("records nothing for %s", async (_, noticed) => {
      expect(await questions.notice("marie", noticed)).toBe(false);

      expect(await questions.open()).toEqual([]);
    });

    it("keeps the question and the AI Coach's answer redacted as AI calls are, never who asked", async () => {
      await questions.notice(
        "marie",
        replied("Je suis Marie Dupont, marie.dupont@example.fr : pourquoi suis-je bloqué à cinq analyses ?", {
          reply: { text: "Marie Dupont, appelez le 06 12 34 56 78 ou écrivez à support@exemple.fr.", outcome: "replied", aboutJobbbox: true },
        }),
      );

      const [kept] = await questions.open();
      expect(kept!.question).toBe("Je suis [NOM], [E-MAIL] : pourquoi suis-je bloqué à cinq analyses ?");
      expect(kept!.answer).toBe("[NOM], appelez le [TÉLÉPHONE] ou écrivez à [E-MAIL 2].");
    });

    it("redacts by shape alone when the Candidate's identity cannot be read", async () => {
      questions = createUnansweredQuestions(database, {
        identityOf: async () => {
          throw new Error("down");
        },
        now: () => now,
      });

      await questions.notice("marie", replied("Écrivez-moi à marie.dupont@example.fr : pourquoi suis-je bloqué à cinq analyses ?"));

      expect((await questions.open())[0]!.question).toBe("Écrivez-moi à [E-MAIL] : pourquoi suis-je bloqué à cinq analyses ?");
    });

    it("has no column that could link a row to a Candidate or a Coach Conversation", async () => {
      const { rows } = await database.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'unanswered_question'`);
      const { rows: keys } = await database.query(`SELECT 1 FROM pg_constraint WHERE contype = 'f' AND conrelid = 'unanswered_question'::regclass`);

      expect(rows.map((row) => row.column_name).filter((column) => /candidate|conversation|account|user/.test(column))).toEqual([]);
      expect(keys).toEqual([]);
    });

    it("takes a page's address down to its route pattern: no id, no query", async () => {
      for (const route of ["/profils/1b2c3d4e-0000-4000-8000-000000000000/cv-de-reference?vue=liste", "/espace-coach/aBc123XyZ/candidatures/1b2c3d4e-0000-4000-8000-000000000000", "pas une page", null]) {
        await questions.notice("marie", replied(QUOTA, { route }));
      }

      expect((await questions.open()).map((each) => [each.route, each.count])).toEqual([
        [null, 2],
        ["/espace-coach/[id]/candidatures/[id]", 1],
        ["/profils/[id]/cv-de-reference", 1],
      ]);
    });
  });

  describe("read by Help editors in « Questions sans réponse »", () => {
    beforeEach(async () => {
      await questions.notice("marie", replied(QUOTA));
      await questions.notice("marie", replied("Où est passé le bouton vert ?", { route: "/" }));
      await questions.notice("jean", replied("Où est passé le bouton vert ?", { route: "/" }));
      await questions.notice("jean", replied("Where did the green button go?", { route: "/", language: "en" }));
    });

    it("lists the open ones, most asked first, by route and by language", async () => {
      expect((await questions.open()).map((each) => each.count)).toEqual([2, 1, 1]);
      expect((await questions.open({ route: "/" })).map((each) => each.question)).toEqual(["Où est passé le bouton vert ?", "Where did the green button go?"]);
      expect((await questions.open({ language: "en" })).map((each) => each.question)).toEqual(["Where did the green button go?"]);
      expect((await questions.open({ route: "/", language: "fr" })).map((each) => each.count)).toEqual([2]);
    });

    it("marks one written or dismissed: it leaves the list, and the same question asked again opens a new one", async () => {
      const [letters, ...rest] = await questions.open();

      expect(await questions.mark(letters!.id, "written")).toMatchObject({ before: { status: "open" }, after: { status: "written", question: letters!.question } });
      expect(await questions.mark(rest[0]!.id, "dismissed")).toMatchObject({ after: { status: "dismissed" } });
      expect((await questions.open()).map((each) => each.id)).toEqual([rest[1]!.id]);
      // Already marked, or unknown: nothing to do.
      expect(await questions.mark(letters!.id, "dismissed")).toBeNull();
      expect(await questions.mark("not-an-id", "written")).toBeNull();

      await questions.notice("marie", replied("Où est passé le bouton vert ?", { route: "/" }));
      expect(await questions.open({ route: "/", language: "fr" })).toEqual([expect.objectContaining({ count: 1, status: "open" })]);
    });
  });

  describe("purged by the worker", () => {
    it("deletes an open one 12 months after it was last asked, and a written or dismissed one 30 days after it was marked", async () => {
      await questions.notice("marie", replied(QUOTA));
      await questions.notice("marie", replied("Où est passé le bouton vert ?"));
      await questions.notice("marie", replied("Puis-je imprimer en noir et blanc ?"));
      const button = (await questions.open()).find((each) => each.question === "Où est passé le bouton vert ?")!;
      now = new Date("2026-11-01T10:00:00Z");
      await questions.mark(button.id, "written");

      expect(await purgeUnansweredQuestions(database, new Date("2026-11-30T10:00:00Z"))).toBe(0);
      expect(await purgeUnansweredQuestions(database, new Date("2026-12-01T10:00:00Z"))).toBe(1);
      now = new Date("2027-01-01T10:00:00Z");
      await questions.notice("marie", replied(QUOTA));
      expect(await purgeUnansweredQuestions(database, new Date("2027-10-24T10:00:00Z"))).toBe(1);
      expect((await questions.open()).map((each) => each.question)).toEqual([QUOTA]);
      expect(await purgeUnansweredQuestions(database, new Date("2028-01-01T10:00:00Z"))).toBe(1);
      expect(await questions.open()).toEqual([]);
    });
  });
});
