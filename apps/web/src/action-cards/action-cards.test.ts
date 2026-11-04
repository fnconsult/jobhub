import { rulesProvenance } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateApplications } from "../applications";
import { migrateCoachConversations } from "../coach-conversations";
import { migrateJobDigests } from "../job-digests";
import { migrateJobOffers } from "../job-offers";
import { migrateJobSearches } from "../job-searches";
import { migrateProfiles } from "../profiles";
import { ActionCardConflict, ActionCardInvalid, createActionCards, migrateActionCards, migrateActionCardsInThread, type ActionCard } from "./index";

const PROFILE = { kind: "profile", id: "11111111-1111-4111-8111-111111111111" } as const;
const OTHER_PROFILE = { kind: "profile", id: "22222222-2222-4222-8222-222222222222" } as const;

const proposal = {
  kind: "ats_fix",
  title: "Ajoutez « IFRS » à vos compétences",
  body: "Les offres de Directrice financière le demandent souvent.",
  focus: PROFILE,
  payload: { skill: "IFRS" },
};

describe.skipIf(!connectionString)("Action Cards (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let jean: string;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateActionCards(database);
    await migrateActionCards(database); // safe to run twice
    marie = await candidate("marie.dupont@example.fr");
    jean = await candidate("jean.martin@example.fr");
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("shows the AI Coach's proposal on the page it is about, until the Candidate decides", async () => {
    const cards = createActionCards(database);
    const proposed = await cards.propose(marie, proposal);

    expect(proposed).toEqual({ ...proposal, id: expect.any(String), status: "pending", createdAt: expect.any(Date), provenance: null });
    expect(await cards.pending(marie, PROFILE)).toEqual([proposed]);
    expect(await cards.pending(marie, OTHER_PROFILE)).toEqual([]);
  });

  it("keeps what made the card, its Provenance (#336); a card proposed before shows « non enregistré »", async () => {
    const cards = createActionCards(database);
    const provenance = rulesProvenance("ats_fixes", { at: new Date("2026-10-24T09:00:00Z"), ms: 3 });
    await cards.propose(marie, { ...proposal, provenance });
    const before = await cards.propose(marie, { ...proposal, payload: { skill: "SAP" } });
    await database.query(`UPDATE action_card SET provenance = '{"v": 1, "text": "not one"}' WHERE id = $1`, [before.id]);

    expect((await cards.pending(marie, PROFILE)).map((card) => card.provenance)).toEqual([provenance, null]);
  });

  it("applies an accepted card through its kind's handler, then takes it off the page", async () => {
    const applied: { candidateId: string; card: ActionCard }[] = [];
    const cards = createActionCards(database, { onAccept: { ats_fix: async (card, candidateId) => void applied.push({ card, candidateId }) } });
    const { id } = await cards.propose(marie, proposal);

    const decided = await cards.decide(marie, id, "accept");

    expect(decided).toMatchObject({ ok: true, card: { id, status: "accepted" } });
    expect(applied).toMatchObject([{ candidateId: marie, card: { id, payload: { skill: "IFRS" } } }]);
    expect(await cards.pending(marie, PROFILE)).toEqual([]);
  });

  it("takes a dismissed card off the page without applying it", async () => {
    let applied = 0;
    const cards = createActionCards(database, { onAccept: { ats_fix: async () => void applied++ } });
    const { id } = await cards.propose(marie, proposal);

    expect(await cards.decide(marie, id, "dismiss")).toMatchObject({ ok: true, card: { status: "dismissed" } });
    expect(applied).toBe(0);
    expect(await cards.pending(marie, PROFILE)).toEqual([]);
  });

  it("remembers the cards the Candidate dismissed on a page, so the same proposal is not made again", async () => {
    const cards = createActionCards(database);
    const dismissed = await cards.propose(marie, proposal);
    const accepted = await cards.propose(marie, { ...proposal, payload: { skill: "SAP" } });
    await cards.propose(marie, { ...proposal, payload: { skill: "ERP" } });
    await cards.decide(marie, dismissed.id, "dismiss");
    await cards.decide(marie, accepted.id, "accept");

    expect(await cards.dismissed(marie, PROFILE)).toEqual([{ ...dismissed, status: "dismissed", decidedAt: expect.any(Date) }]);
    expect(await cards.dismissed(marie, OTHER_PROFILE)).toEqual([]);
    expect(await cards.dismissed(jean, PROFILE)).toEqual([]);
  });

  it("decides a card only once", async () => {
    let applied = 0;
    const cards = createActionCards(database, { onAccept: { ats_fix: async () => void applied++ } });
    const { id } = await cards.propose(marie, proposal);

    await cards.decide(marie, id, "accept");
    expect(await cards.decide(marie, id, "accept")).toEqual({ ok: false, error: "already_decided" });
    expect(await cards.decide(marie, id, "dismiss")).toEqual({ ok: false, error: "already_decided" });
    expect(applied).toBe(1);
  });

  it("keeps the card on the page when applying it fails", async () => {
    const cards = createActionCards(database, {
      onAccept: {
        ats_fix: async () => {
          throw new Error("Master CV changed meanwhile");
        },
      },
    });
    const { id } = await cards.propose(marie, proposal);

    expect(await cards.decide(marie, id, "accept")).toEqual({ ok: false, error: "failed" });
    expect(await cards.pending(marie, PROFILE)).toMatchObject([{ id, status: "pending" }]);
  });

  it("lets the AI Coach withdraw a pending proposal it no longer makes, but never a decided card or someone else's", async () => {
    const cards = createActionCards(database);
    const stale = await cards.propose(marie, proposal);
    const dismissed = await cards.propose(marie, { ...proposal, payload: { skill: "SAP" } });
    await cards.decide(marie, dismissed.id, "dismiss");
    const jeans = await cards.propose(jean, proposal);

    expect(await cards.withdraw(marie, stale.id)).toBe(true);
    expect(await cards.withdraw(marie, dismissed.id)).toBe(false);
    expect(await cards.withdraw(marie, jeans.id)).toBe(false);
    expect(await cards.withdraw(marie, "not-a-card")).toBe(false);

    expect(await cards.pending(marie, PROFILE)).toEqual([]);
    expect(await cards.dismissed(marie, PROFILE)).toEqual([{ ...dismissed, status: "dismissed", decidedAt: expect.any(Date) }]);
    expect(await cards.decide(marie, stale.id, "accept")).toEqual({ ok: false, error: "not_found" });
    expect(await cards.pending(jean, PROFILE)).toEqual([jeans]);
  });

  it("lists a Candidate's pending cards of some kinds, across pages, oldest first", async () => {
    const cards = createActionCards(database);
    const APPLICATION = { kind: "application", id: "33333333-3333-4333-8333-333333333333" } as const;
    const first = await cards.propose(marie, { ...proposal, kind: "follow_up", focus: APPLICATION });
    await cards.propose(marie, proposal);
    const decided = await cards.propose(marie, { ...proposal, kind: "follow_up", focus: APPLICATION });
    const second = await cards.propose(marie, { ...proposal, kind: "abandon_suggestion", focus: OTHER_PROFILE });
    await cards.propose(jean, { ...proposal, kind: "follow_up", focus: APPLICATION });
    await cards.decide(marie, decided.id, "dismiss");

    expect(await cards.pendingOfKinds(marie, ["follow_up", "abandon_suggestion"])).toEqual([first, second]);
    expect(await cards.pendingOfKinds(marie, [])).toEqual([]);
  });

  it("never shows or lets anyone else decide a Candidate's cards", async () => {
    const cards = createActionCards(database);
    const { id } = await cards.propose(marie, proposal);

    expect(await cards.pending(jean, PROFILE)).toEqual([]);
    expect(await cards.decide(jean, id, "dismiss")).toEqual({ ok: false, error: "not_found" });
    expect(await cards.decide(marie, "not-a-uuid", "dismiss")).toEqual({ ok: false, error: "not_found" });
    expect(await cards.pending(marie, PROFILE)).toHaveLength(1);
  });
  describe("in the thread of a Coach Conversation (#715)", () => {
    const STATUS = { kind: "application", id: "33333333-3333-4333-8333-333333333333" } as const;
    const change = { kind: "coach_proposal", title: "Statut", body: "Entretien → Offre", focus: STATUS, payload: { to: "offer" } };
    /** The object the cards change, as its domain module would hold it: its state and a version that moves with each change. */
    let object: { status: string; version: number };

    /** Applies a card if the object is still at the version it saw; gives back what Annuler needs to put it back. */
    const onAccept = {
      coach_proposal: async (card: ActionCard, _candidateId: string, edited?: unknown) => {
        const { to, seen } = card.payload as { to: string; seen?: number };
        if (seen !== undefined && seen !== object.version) throw new ActionCardConflict();
        const status = (edited as { status?: string } | undefined)?.status ?? to;
        if (status === "nonsense") throw new ActionCardInvalid([{ field: "status", code: "invalid" }]);
        const before = object.status;
        object = { status, version: object.version + 1 };
        return { undo: { before, version: object.version } };
      },
    };
    const onUndo = {
      coach_proposal: async (_card: ActionCard, _candidateId: string, undo: unknown) => {
        const { before, version } = undo as { before: string; version: number };
        if (version !== object.version) throw new ActionCardConflict();
        object = { status: before, version: object.version + 1 };
      },
    };
    let reply: string;

    beforeEach(async () => {
      object = { status: "interview", version: 1 };
      await migrateProfiles(database);
      await migrateJobOffers(database);
      await migrateApplications(database);
      await migrateJobSearches(database);
      await migrateJobDigests(database);
      await migrateCoachConversations(database);
      await migrateActionCardsInThread(database);
      await migrateActionCardsInThread(database); // safe to run twice
      const { rows } = await database.query<{ id: string }>(`INSERT INTO coach_conversation (candidate_id, title) VALUES ($1, 'Statut') RETURNING id`, [marie]);
      const saved = await database.query<{ seq: string }>(`INSERT INTO coach_message (conversation_id, author, text) VALUES ($1, 'coach', 'Passez-la en Offre.') RETURNING seq`, [rows[0]!.id]);
      reply = saved.rows[0]!.seq;
    });

    it("lists a reply's cards whatever their status, never among a page's own cards", async () => {
      const cards = createActionCards(database, { onAccept, onUndo });
      const first = await cards.propose(marie, { ...change, reply });
      const second = await cards.propose(marie, { ...change, payload: { to: "rejected" }, reply });
      await cards.decide(marie, second.id, "dismiss");

      expect(first).toMatchObject({ reply, status: "pending" });
      expect(await cards.inThread(marie, [reply])).toEqual([first, { ...second, status: "dismissed", decidedAt: expect.any(Date) }]);
      expect(await cards.inThread(jean, [reply])).toEqual([]);
      expect(await cards.pending(marie, STATUS)).toEqual([]);
      expect(await cards.pendingOfKinds(marie, ["coach_proposal"])).toEqual([]);
    });

    it("refuses to apply a card whose object changed since the proposal, as a conflict, never merged: it stays pending", async () => {
      const cards = createActionCards(database, { onAccept, onUndo });
      const { id } = await cards.propose(marie, { ...change, payload: { to: "offer", seen: 1 }, reply });
      object = { status: "rejected", version: 2 }; // changed on its page meanwhile

      expect(await cards.decide(marie, id, "accept")).toEqual({ ok: false, error: "conflict" });
      expect(object).toEqual({ status: "rejected", version: 2 });
      expect(await cards.inThread(marie, [reply])).toMatchObject([{ id, status: "pending" }]);
    });

    it("applies what the Candidate edited before applying, refused by the domain's own validation when it does not read", async () => {
      const cards = createActionCards(database, { onAccept, onUndo });
      const { id } = await cards.propose(marie, { ...change, reply });

      expect(await cards.decide(marie, id, "accept", { edited: { status: "nonsense" } })).toEqual({ ok: false, error: "invalid", errors: [{ field: "status", code: "invalid" }] });
      expect(await cards.inThread(marie, [reply])).toMatchObject([{ id, status: "pending" }]);

      expect(await cards.decide(marie, id, "accept", { edited: { status: "rejected" } })).toMatchObject({ ok: true, card: { status: "accepted", edited: { status: "rejected" } } });
      expect(object.status).toBe("rejected");
    });

    it("« Annuler » puts back the state before an applied card, through its kind's handler, once", async () => {
      const cards = createActionCards(database, { onAccept, onUndo });
      const { id } = await cards.propose(marie, { ...change, reply });
      const applied = await cards.decide(marie, id, "accept");

      expect(applied).toMatchObject({ ok: true, card: { status: "accepted", decidedAt: expect.any(Date), undoable: true } });
      expect(object.status).toBe("offer");

      const undone = await cards.undo(marie, id);
      expect(undone).toMatchObject({ ok: true, card: { status: "undone", decidedAt: expect.any(Date), undoneAt: expect.any(Date) } });
      expect(undone.ok && undone.card.undoable).toBeFalsy();
      expect(object.status).toBe("interview");
      expect(await cards.undo(marie, id)).toEqual({ ok: false, error: "already_decided" });
      expect(await cards.decide(marie, id, "accept")).toEqual({ ok: false, error: "already_decided" });
    });

    it("refuses « Annuler » once the object changed since it was applied: a conflict, the card stays applied", async () => {
      const cards = createActionCards(database, { onAccept, onUndo });
      const { id } = await cards.propose(marie, { ...change, reply });
      await cards.decide(marie, id, "accept");
      object = { status: "withdrawn", version: object.version + 1 }; // changed on its page since

      expect(await cards.undo(marie, id)).toEqual({ ok: false, error: "conflict" });
      expect(object.status).toBe("withdrawn");
      expect(await cards.inThread(marie, [reply])).toMatchObject([{ id, status: "accepted", undoable: true }]);
    });

    it("never decides a card twice: no Annuler for a pending, dismissed or launched card, nor for someone else's", async () => {
      const launched = createActionCards(database, { onAccept: { coach_proposal: async () => undefined }, onUndo });
      const pending = await launched.propose(marie, { ...change, reply });
      const dismissed = await launched.propose(marie, { ...change, reply });
      const started = await launched.propose(marie, { ...change, reply });
      await launched.decide(marie, dismissed.id, "dismiss");
      await launched.decide(marie, started.id, "accept");

      expect(await launched.undo(marie, pending.id)).toEqual({ ok: false, error: "not_undoable" });
      expect(await launched.undo(marie, dismissed.id)).toEqual({ ok: false, error: "already_decided" });
      expect(await launched.undo(marie, started.id)).toEqual({ ok: false, error: "not_undoable" });
      expect(await launched.undo(jean, started.id)).toEqual({ ok: false, error: "not_found" });
      expect(await launched.undo(marie, "not-a-card")).toEqual({ ok: false, error: "not_found" });
      expect(await launched.decide(marie, dismissed.id, "accept")).toEqual({ ok: false, error: "already_decided" });
    });

    it("lets a new reply withdraw a pending card it no longer proposes, never an applied one", async () => {
      const cards = createActionCards(database, { onAccept, onUndo });
      const stale = await cards.propose(marie, { ...change, reply });
      const applied = await cards.propose(marie, { ...change, reply });
      await cards.decide(marie, applied.id, "accept");

      expect(await cards.withdraw(marie, stale.id)).toBe(true);
      expect(await cards.withdraw(marie, applied.id)).toBe(false);
      expect((await cards.inThread(marie, [reply])).map((card) => card.id)).toEqual([applied.id]);
    });

    it("goes with its reply: a conversation deleted takes its cards along", async () => {
      const cards = createActionCards(database, { onAccept, onUndo });
      await cards.propose(marie, { ...change, reply });

      await database.query(`DELETE FROM coach_conversation WHERE candidate_id = $1`, [marie]);

      expect(await cards.inThread(marie, [reply])).toEqual([]);
      expect((await database.query(`SELECT 1 FROM action_card`)).rows).toEqual([]);
    });
  });
});
