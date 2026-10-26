import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createSignalements, migrateSignalements, purgeSignalements, signalementsOf, type Signalements, type SendingContext } from "./index";

const CHROME_ON_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Safari/537.36";
const FROM_MARIE: SendingContext = { userAgent: CHROME_ON_MAC, interfaceLanguage: "fr" };

const bug = (more: Record<string, unknown> = {}) => ({
  type: "bug",
  message: "Le bouton « Enregistrer » ne fait rien sur ma lettre.",
  path: "/candidatures/0b6c2f1e-1111-4111-8111-111111111111/documents?onglet=lettre&email=marie.dupont@example.fr#haut",
  textSize: "large",
  ...more,
});

describe.skipIf(!connectionString)("Signalements (#374, #283; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let now: Date;
  let signalements: Signalements;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateSignalements(database);
    await migrateSignalements(database); // safe to run twice
    marie = await candidate("marie.dupont@example.fr");
    now = new Date("2026-10-25T09:30:00Z");
    signalements = createSignalements(database, { version: "35e2ea1", now: () => now });
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  describe("sending", () => {
    it("stores the Signalement with its context: the page's path, the Jobbbox version, the browser parsed, the Interface Language and the Text Size", async () => {
      const sent = await signalements.send(marie, bug(), FROM_MARIE);

      expect(sent).toEqual({
        ok: true,
        signalement: {
          id: expect.any(String),
          type: "bug",
          message: "Le bouton « Enregistrer » ne fait rien sur ma lettre.",
          attachedQuestion: null,
          attachedCoachReply: null,
          context: {
            path: "/candidatures/0b6c2f1e-1111-4111-8111-111111111111/documents",
            version: "35e2ea1",
            browser: "Chrome 141, Mac",
            interfaceLanguage: "fr",
            textSize: "large",
          },
          status: "nouveau",
          statusChangedAt: null,
          reply: null,
          repliedAt: null,
          replyUpdatedAt: null,
          createdAt: now,
        },
      });
    });

    it("never stores the query string, the #… or the raw user agent", async () => {
      await signalements.send(marie, bug(), FROM_MARIE);

      const { rows } = await database.query<{ row: string }>(`SELECT row_to_json(s)::text AS row FROM signalement s`);
      expect(rows).toHaveLength(1);
      for (const leak of ["onglet", "marie.dupont@example.fr", "#haut", "Mozilla", "AppleWebKit", "7390"]) expect(rows[0]!.row).not.toContain(leak);
    });

    it.each([
      ["no type", { type: undefined }, [{ field: "type", code: "required" }]],
      ["another type", { type: "plainte" }, [{ field: "type", code: "invalid" }]],
      ["a blank message", { message: "   " }, [{ field: "message", code: "required" }]],
      ["a message under 10 characters", { message: "  Ça bug.  " }, [{ field: "message", code: "too_short" }]],
      ["a message over 2,000 characters", { message: "a".repeat(2_001) }, [{ field: "message", code: "too_long" }]],
      ["a message that is not text", { message: 42 }, [{ field: "message", code: "invalid" }]],
      ["a Question without the coach exchange", { type: "question", attachedQuestion: "Comment exporter ?" }, [{ field: "attachedCoachReply", code: "required" }]],
    ])("refuses %s, storing nothing", async (_, change, errors) => {
      expect(await signalements.send(marie, bug(change), FROM_MARIE)).toEqual({ ok: false, errors });
      expect(await signalements.send(marie, "pas un objet", FROM_MARIE)).toMatchObject({ ok: false });

      expect((await database.query(`SELECT 1 FROM signalement`)).rowCount).toBe(0);
    });

    it("accepts a message of exactly 10 and of exactly 2,000 characters, trimmed", async () => {
      expect(await signalements.send(marie, bug({ message: "  Ça bugge !  " }), FROM_MARIE)).toMatchObject({ ok: true, signalement: { message: "Ça bugge !" } });
      expect(await signalements.send(marie, bug({ message: "a".repeat(2_000) }), FROM_MARIE)).toMatchObject({ ok: true });
    });

    it("keeps a copy of a Question's question and coach reply, and ignores those a Bug or an Idée carries", async () => {
      const question = await signalements.send(
        marie,
        bug({ type: "question", message: "Je ne trouve toujours pas l'export PDF.", attachedQuestion: "Comment exporter mon CV ?", attachedCoachReply: "Ouvrez votre Profil, puis « Exporter »." }),
        FROM_MARIE,
      );
      const idee = await signalements.send(marie, bug({ type: "idee", attachedQuestion: "Comment exporter mon CV ?", attachedCoachReply: "Ouvrez votre Profil." }), FROM_MARIE);

      expect(question).toMatchObject({ ok: true, signalement: { type: "question", attachedQuestion: "Comment exporter mon CV ?", attachedCoachReply: "Ouvrez votre Profil, puis « Exporter »." } });
      expect(idee).toMatchObject({ ok: true, signalement: { type: "idee", attachedQuestion: null, attachedCoachReply: null } });
    });

    it("keeps what it cannot read of the context as unknown, a stale Text Size as standard and an unknown language as French", async () => {
      const sent = await signalements.send(marie, bug({ path: "javascript:alert(1)", textSize: "géante" }), { userAgent: null, interfaceLanguage: "de" });

      expect(sent).toMatchObject({ ok: true, signalement: { context: { path: null, version: "35e2ea1", browser: null, interfaceLanguage: "fr", textSize: "standard" } } });
    });
  });

  describe("handled by the team (the Back Office's side, #376)", () => {
    async function sent(change: Record<string, unknown> = {}) {
      const result = await signalements.send(marie, bug(change), FROM_MARIE);
      if (!result.ok) throw new Error("fixture Signalement refused");
      return result.signalement;
    }
    const QUESTION = { type: "question", message: "Je ne trouve pas l'export PDF.", attachedQuestion: "Comment exporter ?", attachedCoachReply: "Je ne sais pas." };

    it("changes a status in any direction, dated, saying what it was before", async () => {
      const signalement = await sent();
      now = new Date("2026-10-26T10:00:00Z");

      const seen = await signalements.changeStatus(signalement.id, "vu");
      now = new Date("2026-10-27T10:00:00Z");
      const back = await signalements.changeStatus(signalement.id, "nouveau");

      expect(seen).toEqual({ before: signalement, after: { ...signalement, status: "vu", statusChangedAt: new Date("2026-10-26T10:00:00Z") } });
      expect(back).toMatchObject({ before: { status: "vu" }, after: { status: "nouveau", statusChangedAt: now } });
    });

    it("keeps the date when the status is set to what it already is", async () => {
      const signalement = await sent();

      expect(await signalements.changeStatus(signalement.id, "nouveau")).toEqual({ before: signalement, after: signalement });
    });

    it("saves one reply, dated, editable until the Signalement is marked « traité », and at most 2,000 characters", async () => {
      const signalement = await sent();
      now = new Date("2026-10-26T10:00:00Z");

      expect(await signalements.reply(signalement.id, "  Merci, c'est corrigé.  ")).toMatchObject({ before: { reply: null }, after: { reply: "Merci, c'est corrigé.", replyUpdatedAt: now } });
      expect(await signalements.reply(signalement.id, "a".repeat(2_001))).toEqual({ errors: [{ field: "reply", code: "too_long" }] });
      expect(await signalements.reply(signalement.id, " ")).toEqual({ errors: [{ field: "reply", code: "required" }] });
      await signalements.changeStatus(signalement.id, "traite");
      expect(await signalements.reply(signalement.id, "Encore une chose.")).toEqual({ refused: "already_handled" });
    });

    it("keeps the date of the first reply when the reply is changed, which the Candidate sees as « modifiée le … » (#377)", async () => {
      const signalement = await sent();
      now = new Date("2026-10-26T10:00:00Z");
      await signalements.reply(signalement.id, "Nous regardons.");
      now = new Date("2026-10-27T10:00:00Z");

      expect(await signalements.reply(signalement.id, "C'est corrigé.")).toMatchObject({
        before: { repliedAt: new Date("2026-10-26T10:00:00Z"), replyUpdatedAt: new Date("2026-10-26T10:00:00Z") },
        after: { reply: "C'est corrigé.", repliedAt: new Date("2026-10-26T10:00:00Z"), replyUpdatedAt: now },
      });
    });

    it("marks a Bug or an Idée « traité » without a reply, never a Question", async () => {
      const question = await sent(QUESTION);

      expect(await signalements.changeStatus((await sent()).id, "traite")).toMatchObject({ after: { status: "traite" } });
      expect(await signalements.changeStatus(question.id, "traite")).toEqual({ refused: "reply_required" });
      await signalements.reply(question.id, "L'export PDF est dans le menu du CV.");
      expect(await signalements.changeStatus(question.id, "traite")).toMatchObject({ after: { status: "traite" } });
    });

    it("finds nothing to change for an unknown id or status", async () => {
      expect(await signalements.changeStatus("0b6c2f1e-1111-4111-8111-111111111111", "vu")).toBeNull();
      expect(await signalements.changeStatus("pas-un-id", "vu")).toBeNull();
      expect(await signalements.changeStatus((await sent()).id, "ferme" as never)).toBeNull();
      expect(await signalements.reply("pas-un-id", "Merci.")).toBeNull();
    });
  });

  describe("the Candidate's side: their notifications and deleting one (#377)", () => {
    async function sent(change: Record<string, unknown> = {}) {
      const result = await signalements.send(marie, bug(change), FROM_MARIE);
      if (!result.ok) throw new Error("fixture Signalement refused");
      return result.signalement;
    }

    it("tells the Candidate when the team replied or marked it « traité », newest first, never when it was only marked « vu »", async () => {
      const seen = await sent();
      now = new Date("2026-10-25T10:00:00Z");
      const replied = await sent();
      now = new Date("2026-10-25T11:00:00Z");
      const handled = await sent();
      now = new Date("2026-10-26T10:00:00Z");

      await signalements.changeStatus(seen.id, "vu");
      await signalements.reply(replied.id, "Merci, c'est corrigé.");
      await signalements.changeStatus(handled.id, "traite");

      expect(await signalements.notifications(marie)).toEqual([
        { signalementId: handled.id, sentAt: "2026-10-25T11:00:00.000Z", replied: false },
        { signalementId: replied.id, sentAt: "2026-10-25T10:00:00.000Z", replied: true },
      ]);
    });

    it("closes one notification, or every one when the Section is opened; a reply saved later notifies again", async () => {
      const first = await sent();
      const second = await sent();
      const jeans = await signalements.send(await candidate("jean.martin@example.fr"), bug(), FROM_MARIE);
      if (!jeans.ok) throw new Error("fixture Signalement refused");
      now = new Date("2026-10-26T10:00:00Z");
      for (const { id } of [first, second, jeans.signalement]) await signalements.reply(id, "Merci, c'est corrigé.");

      await signalements.closeNotifications(marie, first.id);
      expect((await signalements.notifications(marie)).map((each) => each.signalementId)).toEqual([second.id]);
      await signalements.closeNotifications(marie);
      expect(await signalements.notifications(marie)).toEqual([]);

      now = new Date("2026-10-27T10:00:00Z");
      await signalements.reply(first.id, "Merci, c'est corrigé pour de bon.");
      expect(await signalements.notifications(marie)).toEqual([{ signalementId: first.id, sentAt: first.createdAt.toISOString(), replied: true }]);
    });

    it("never closes another Candidate's notification", async () => {
      const jean = await candidate("jean.martin@example.fr");
      const jeans = await signalements.send(jean, bug(), FROM_MARIE);
      if (!jeans.ok) throw new Error("fixture Signalement refused");
      now = new Date("2026-10-26T10:00:00Z");
      await signalements.changeStatus(jeans.signalement.id, "traite");

      await signalements.closeNotifications(marie, jeans.signalement.id);
      await signalements.closeNotifications(marie);
      await signalements.closeNotifications(marie, "pas-un-id");

      expect(await signalements.notifications(jean)).toEqual([{ signalementId: jeans.signalement.id, sentAt: "2026-10-25T09:30:00.000Z", replied: false }]);
    });

    it("deletes one of the Candidate's own, never another Candidate's", async () => {
      const kept = await sent();
      const deleted = await sent();
      const jean = await candidate("jean.martin@example.fr");
      const jeans = await signalements.send(jean, bug(), FROM_MARIE);
      if (!jeans.ok) throw new Error("fixture Signalement refused");

      expect(await signalements.remove(marie, deleted.id)).toBe(true);
      expect(await signalements.remove(marie, deleted.id)).toBe(false);
      expect(await signalements.remove(marie, jeans.signalement.id)).toBe(false);
      expect(await signalements.remove(marie, "pas-un-id")).toBe(false);

      expect((await signalementsOf(database, marie)).map(({ id }) => id)).toEqual([kept.id]);
      expect((await signalementsOf(database, jean)).map(({ id }) => id)).toEqual([jeans.signalement.id]);
    });
  });

  describe("the purge, 12 months after a Signalement was marked « traité »", () => {
    async function sentAt(at: string, status?: "vu" | "traite", changedAt?: string) {
      now = new Date(at);
      const result = await signalements.send(marie, bug(), FROM_MARIE);
      if (!result.ok) throw new Error("fixture Signalement refused");
      if (status) {
        now = new Date(changedAt ?? at);
        await signalements.changeStatus(result.signalement.id, status);
      }
      return result.signalement.id;
    }

    it("removes one marked « traité » more than 12 months ago, and keeps one « nouveau » or « vu » of any age and one marked « traité » since", async () => {
      const handledLongAgo = await sentAt("2024-01-10T08:00:00Z", "traite", "2025-10-24T08:00:00Z");
      const nouveau = await sentAt("2020-01-10T08:00:00Z");
      const vu = await sentAt("2021-01-10T08:00:00Z", "vu");
      const handledLately = await sentAt("2024-01-11T08:00:00Z", "traite", "2025-10-26T08:00:00Z");

      expect(await purgeSignalements(database, new Date("2026-10-25T09:30:00Z"))).toBe(1);
      expect(await purgeSignalements(database, new Date("2026-10-25T09:30:00Z"))).toBe(0);

      const kept = (await signalementsOf(database, marie)).map((signalement) => signalement.id);
      expect(kept).not.toContain(handledLongAgo);
      expect(kept.sort()).toEqual([nouveau, vu, handledLately].sort());
    });
  });

  describe("the limit of 10 in a rolling 24 hours, counted in the database", () => {
    async function sendAt(at: string, candidateId = marie) {
      now = new Date(at);
      return signalements.send(candidateId, bug(), FROM_MARIE);
    }

    it("refuses the 11th within 24 hours, and accepts the 1st after the window", async () => {
      await sendAt("2026-10-25T08:00:00Z");
      for (let sent = 2; sent <= 10; sent++) expect(await sendAt("2026-10-25T20:00:00Z")).toMatchObject({ ok: true });

      expect(await sendAt("2026-10-26T07:59:00Z")).toEqual({ ok: false, refused: "too_many" });
      expect(await sendAt("2026-10-26T08:00:00Z")).toMatchObject({ ok: true });
      expect(await sendAt("2026-10-26T08:01:00Z")).toEqual({ ok: false, refused: "too_many" });
    });

    it("counts each Candidate's own, and holds when they are sent all at once", async () => {
      const jean = await candidate("jean.martin@example.fr");
      now = new Date("2026-10-25T08:00:00Z");

      const sent = await Promise.all(Array.from({ length: 14 }, () => signalements.send(marie, bug(), FROM_MARIE)));

      expect(sent.filter((each) => each.ok)).toHaveLength(10);
      expect(sent.filter((each) => !each.ok)).toEqual(Array.from({ length: 4 }, () => ({ ok: false, refused: "too_many" })));
      expect(await signalements.send(jean, bug(), FROM_MARIE)).toMatchObject({ ok: true });
    });
  });
});
