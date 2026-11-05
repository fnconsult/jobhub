import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActionCards, migrateActionCards, migrateActionCardsInThread, type ActionCards } from "../action-cards";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { E2E_STATUS_ACTION, e2eCoachActions } from "../coach-actions/e2e-catalog";
import { defineCoachAction, type CoachAction, type CoachProposal } from "../coach-actions";
import { migrateCoachConversations } from "../coach-conversations";
import { migrateJobDigests } from "../job-digests";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { migrateJobSearches } from "../job-searches";
import { createProfiles, migrateProfiles } from "../profiles";
import * as z from "zod";
import { coachProposalHandlers, createCoachProposals, type CoachProposals } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

describe.skipIf(!connectionString)("Coach proposals in the thread (#715, needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let applications: Applications;
  let catalog: CoachAction[];
  let actionCards: ActionCards;
  let proposals: CoachProposals;
  let marie: string;
  let paul: string;
  let applicationId: string;
  let conversationId: string;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  /** A reply of Marie's conversation, saved: its seq. */
  async function reply(): Promise<string> {
    const { rows } = await database.query<{ seq: string }>(`INSERT INTO coach_message (conversation_id, author, text) VALUES ($1, 'coach', 'Passez-la en Entretien.') RETURNING seq`, [
      conversationId,
    ]);
    return rows[0]!.seq;
  }

  /** What the fake Coach Action proposes for Marie's Application, as a reply's proposal. */
  async function proposeStatus(status: string, owner = marie, id = applicationId): Promise<CoachProposal> {
    const action = catalog.find((each) => each.name === E2E_STATUS_ACTION)!;
    const ran = await action.run({ id, status }, { candidateId: owner, language: "fr" });
    if (!ran.ok) throw new Error("not proposed");
    return { action: action.name, group: action.group, data: ran.data };
  }

  const status = async () => (await applications.statusOf(marie, applicationId))?.status;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateJobSearches(database);
    await migrateJobDigests(database);
    await migrateActionCards(database);
    await migrateCoachConversations(database);
    await migrateActionCardsInThread(database);
    const profiles = createProfiles(database);
    const jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    catalog = e2eCoachActions(applications);
    actionCards = createActionCards(database, coachProposalHandlers(catalog, () => new Date("2026-11-04T17:20:00Z")));
    proposals = createCoachProposals({ catalog, actionCards });
    marie = await signIn("marie.dupont@example.fr");
    paul = await signIn("paul.martin@example.fr");
    const created = await profiles.create(marie, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    const captured = await jobOffers.capture({ source: { url: "https://www.apec.fr/offre/1" }, title: "DAF H/F", content: "DAF pour un groupe industriel.", employer: "Acme Industrie" });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    const saved = await applications.save(marie, { jobOfferId: captured.jobOffer.id, profileId: created.profile.id });
    if (!saved.ok) throw new Error("fixture Application refused");
    applicationId = saved.application.id;
    await applications.change(marie, applicationId, { status: "applied" });
    const { rows } = await database.query<{ id: string }>(`INSERT INTO coach_conversation (candidate_id, title) VALUES ($1, 'Ma candidature') RETURNING id`, [marie]);
    conversationId = rows[0]!.id;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("places a reply's proposal under it as a pending card: what changes, before → after, the object linked", async () => {
    const at = await reply();

    const placed = await proposals.place(marie, { reply: at, earlier: [] }, [await proposeStatus("interview")]);

    expect(placed).toEqual([
      {
        id: expect.any(String),
        status: "pending",
        change: {
          target: { kind: "application", id: applicationId, name: "DAF H/F · Acme Industrie", href: `/candidatures/${applicationId}` },
          what: "Statut de la candidature",
          before: "Postulée",
          after: "Entretien",
          value: { status: "interview" },
          fields: [expect.objectContaining({ name: "status", type: "select" })],
        },
        undoable: false,
      },
    ]);
    expect(await proposals.ofReplies(marie, [at])).toEqual(new Map([[at, placed]]));
    expect(await proposals.ofReplies(paul, [at])).toEqual(new Map());
    // Proposed, nothing changed.
    expect(await status()).toBe("applied");
  });

  it("leaves out a proposal its Coach Action cannot apply: one with no `apply`, or that prepared no change a card can show", async () => {
    const readOnly = defineCoachAction({ ...catalog[0]!, name: "proposer_sans_carte", apply: undefined, undo: undefined, schema: z.object({}) });
    const withOther = createCoachProposals({ catalog: [...catalog, readOnly], actionCards });
    const at = await reply();

    expect(await withOther.place(marie, { reply: at, earlier: [] }, [{ action: "proposer_sans_carte", group: "applications", data: (await proposeStatus("interview")).data }])).toEqual([]);
    expect(await withOther.place(marie, { reply: at, earlier: [] }, [{ action: E2E_STATUS_ACTION, group: "applications", data: { applicationId, to: "interview" } }])).toEqual([]);
    expect(await actionCards.inThread(marie, [at])).toEqual([]);
  });

  it("« Appliquer » changes the object through its domain module, which keeps the card as its hidden Origin", async () => {
    const at = await reply();
    const [card] = await proposals.place(marie, { reply: at, earlier: [] }, [await proposeStatus("interview")]);

    const applied = await actionCards.decide(marie, card!.id, "accept");

    expect(applied).toMatchObject({ ok: true, card: { status: "accepted", undoable: true } });
    expect(await applications.statusOf(marie, applicationId)).toMatchObject({
      status: "interview",
      origin: { origin: "coach_proposal", cardId: card!.id, appliedAt: new Date("2026-11-04T17:20:00Z") },
    });
    expect((await proposals.ofReplies(marie, [at])).get(at)).toMatchObject([{ id: card!.id, status: "accepted", decidedAt: expect.any(String), undoable: true }]);
  });

  it("applies what the Candidate edited in the Work Pane, kept to the form's fields and checked as the page checks it", async () => {
    const at = await reply();
    const [card] = await proposals.place(marie, { reply: at, earlier: [] }, [await proposeStatus("interview")]);

    expect(await actionCards.decide(marie, card!.id, "accept", { edited: { status: "hired" } })).toEqual({ ok: false, error: "invalid", errors: [{ field: "status", code: "invalid" }] });
    expect(await actionCards.decide(marie, card!.id, "accept", { edited: { status: "offer_received", applicationId: "someone-else" } })).toMatchObject({ ok: true });

    expect(await status()).toBe("offer_received");
    expect((await proposals.ofReplies(marie, [at])).get(at)).toMatchObject([{ edited: { status: "offer_received" } }]);
  });

  it("refuses « Appliquer » as a conflict when the object changed since the proposal, never merged: the card stays pending", async () => {
    const at = await reply();
    const [card] = await proposals.place(marie, { reply: at, earlier: [] }, [await proposeStatus("interview")]);
    await applications.change(marie, applicationId, { status: "rejected" }); // on its page, meanwhile

    expect(await actionCards.decide(marie, card!.id, "accept")).toEqual({ ok: false, error: "conflict" });
    expect(await status()).toBe("rejected");
    expect((await proposals.ofReplies(marie, [at])).get(at)).toMatchObject([{ status: "pending" }]);
  });

  it("« Annuler » puts the state before back, its Origin too, by the same module", async () => {
    const at = await reply();
    const [card] = await proposals.place(marie, { reply: at, earlier: [] }, [await proposeStatus("interview")]);
    await actionCards.decide(marie, card!.id, "accept");

    expect(await actionCards.undo(marie, card!.id)).toMatchObject({ ok: true, card: { status: "undone", undoneAt: expect.any(Date) } });
    expect(await applications.statusOf(marie, applicationId)).toMatchObject({ status: "applied", origin: null });
    expect((await proposals.ofReplies(marie, [at])).get(at)).toMatchObject([{ status: "undone", undoneAt: expect.any(String), undoable: false }]);
  });

  it("refuses « Annuler » once the object changed since it was applied: a conflict, the change since kept", async () => {
    const at = await reply();
    const [card] = await proposals.place(marie, { reply: at, earlier: [] }, [await proposeStatus("interview")]);
    await actionCards.decide(marie, card!.id, "accept");
    await applications.change(marie, applicationId, { status: "offer_received" }); // on its page, since

    expect(await actionCards.undo(marie, card!.id)).toEqual({ ok: false, error: "conflict" });
    expect(await status()).toBe("offer_received");
    expect((await proposals.ofReplies(marie, [at])).get(at)).toMatchObject([{ status: "accepted" }]);
  });

  it("never decides a card twice", async () => {
    const at = await reply();
    const [card] = await proposals.place(marie, { reply: at, earlier: [] }, [await proposeStatus("interview")]);
    await actionCards.decide(marie, card!.id, "accept");

    expect(await actionCards.decide(marie, card!.id, "accept")).toEqual({ ok: false, error: "already_decided" });
    expect(await actionCards.decide(marie, card!.id, "dismiss")).toEqual({ ok: false, error: "already_decided" });
    await actionCards.undo(marie, card!.id);
    expect(await actionCards.undo(marie, card!.id)).toEqual({ ok: false, error: "already_decided" });
    expect(await actionCards.decide(paul, card!.id, "accept")).toEqual({ ok: false, error: "not_found" });
    expect(await status()).toBe("applied");
  });

  it("withdraws a pending card of an earlier reply that a newer reply proposes again, never a decided one nor another object's", async () => {
    const first = await reply();
    const [stale] = await proposals.place(marie, { reply: first, earlier: [] }, [await proposeStatus("interview")]);
    const second = await reply();
    const [kept] = await proposals.place(marie, { reply: second, earlier: [first] }, [await proposeStatus("interview")]);
    await actionCards.decide(marie, kept!.id, "accept");
    const third = await reply();

    await proposals.place(marie, { reply: third, earlier: [first, second] }, [await proposeStatus("offer_received")]);

    expect((await proposals.ofReplies(marie, [first, second, third])).get(first)).toBeUndefined();
    expect((await proposals.ofReplies(marie, [first, second, third])).get(second)).toMatchObject([{ id: kept!.id, status: "accepted" }]);
    expect((await proposals.ofReplies(marie, [third])).get(third)).toMatchObject([{ status: "pending", change: { after: "Offre reçue" } }]);
    expect(stale).toBeDefined();
  });
});
