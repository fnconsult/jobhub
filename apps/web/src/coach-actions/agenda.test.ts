/**
 * The Agenda's Coach Actions (#718, ADR-0077), on Postgres, through what the app runs: each Coach Action prepares a
 * proposal (nothing written), its card is placed in the thread, « Appliquer » and « Annuler » go through the Applications
 * module (addInterview, editInterview, cancelInterview), the Interview keeping its Origin.
 */
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActionCards, migrateActionCards, migrateActionCardsInThread, type ActionCards } from "../action-cards";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateCoachConversations } from "../coach-conversations";
import { coachProposalHandlers, createCoachProposals, type CoachProposals } from "../coach-proposals";
import { migrateJobDigests } from "../job-digests";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { migrateJobSearches } from "../job-searches";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { AGENDA_ACTIONS, agendaCoachActions } from "./agenda";
import type { CoachAction, CoachActionResult, CoachProposal } from "./index";

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

describe("the Agenda's Coach Actions, as declared (#718)", () => {
  const catalog = agendaCoachActions({} as Applications);

  it("adds, moves and cancels an Interview: three proposing actions of the Agenda group, none copying text, none deleting", () => {
    expect(catalog.map((action) => [action.name, action.group, action.kind, action.copiesText])).toEqual([
      [AGENDA_ACTIONS.add, "agenda", "propose", false],
      [AGENDA_ACTIONS.change, "agenda", "propose", false],
      [AGENDA_ACTIONS.cancel, "agenda", "propose", false],
    ]);
    expect(catalog.every((action) => action.apply && action.undo)).toBe(true);
    expect(catalog.some((action) => /delete|supprim|remove/i.test(action.name))).toBe(false);
  });

  it("asks the model for an absolute date and time in French time, a relative one resolved from the date of the day, and never for a note", () => {
    const add = catalog.find((action) => action.name === AGENDA_ACTIONS.add)!;

    expect(add.description).toMatch(/date du jour/);
    expect(add.description).toMatch(/heure de Paris/);
    expect(Object.keys(add.schema.shape)).toEqual(["applicationId", "scheduledAt", "durationMinutes", "format", "place"]);
    expect(add.schema.safeParse({ applicationId: "a1", scheduledAt: "jeudi 14 h" }).success).toBe(false);
    expect(add.schema.safeParse({ applicationId: "a1", scheduledAt: "2026-11-12T14:00" }).success).toBe(true);
    expect(catalog.find((action) => action.name === AGENDA_ACTIONS.change)!.description).toMatch(/Supprimer/);
  });
});

describe.skipIf(!connectionString)("the Agenda's Coach Actions, applied (#718, needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let applications: Applications;
  let catalog: CoachAction[];
  let actionCards: ActionCards;
  let proposals: CoachProposals;
  let marie: string;
  let paul: string;
  let profileId: string;
  let applicationId: string;
  let conversationId: string;
  /** The clock of the Interviews' dates: Thursday 5 November 2026, 10:00 French time. */
  let now: Date;
  const later = (minutes: number) => {
    now = new Date(now.getTime() + minutes * 60_000);
  };

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  /** What `name` prepares with `args` for `owner`, in French. */
  async function run(name: string, args: Record<string, unknown>, owner = marie, language: "fr" | "en" = "fr"): Promise<CoachActionResult> {
    const action = catalog.find((each) => each.name === name)!;
    return action.run(action.schema.parse(args), { candidateId: owner, language });
  }

  /** A card under a new reply of Marie's conversation for what `name` proposes. */
  async function cardFor(name: string, args: Record<string, unknown>) {
    const ran = await run(name, args);
    if (!ran.ok) throw new Error("not proposed");
    const { rows } = await database.query<{ seq: string }>(`INSERT INTO coach_message (conversation_id, author, text) VALUES ($1, 'coach', 'Je vous propose ceci.') RETURNING seq`, [conversationId]);
    const proposal: CoachProposal = { action: name, group: "agenda", data: ran.data };
    const [card] = await proposals.place(marie, { reply: rows[0]!.seq, earlier: [] }, [proposal]);
    return card!;
  }

  const application = async () => (await applications.get(marie, applicationId))!;
  const origin = (cardId: string) => ({ origin: "coach_proposal", cardId, appliedAt: new Date("2026-11-05T09:20:00Z") });

  /** An Interview Marie entered herself, a day ago, at "Entretien". */
  async function enteredInterview(scheduledAt = "2026-11-12T14:00") {
    await applications.change(marie, applicationId, { status: "interview" });
    later(-24 * 60);
    const added = await applications.addInterview(marie, applicationId, { scheduledAt, durationMinutes: 60, format: "on_site", place: "Siège, Toulouse" });
    later(24 * 60);
    if (!added.ok) throw new Error("fixture Interview refused");
    return added.interviewId;
  }

  beforeEach(async () => {
    now = new Date("2026-11-05T09:00:00.000Z");
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
    profiles = createProfiles(database);
    const jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles, now: () => now });
    catalog = agendaCoachActions(applications);
    actionCards = createActionCards(database, coachProposalHandlers(catalog, () => new Date("2026-11-05T09:20:00Z")));
    proposals = createCoachProposals({ catalog, actionCards });
    marie = await signIn("marie.dupont@example.fr");
    paul = await signIn("paul.martin@example.fr");
    const created = await profiles.create(marie, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Toulouse"], contractTypes: ["cdi"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    profileId = created.profile.id;
    const captured = await jobOffers.capture({ source: { url: "https://www.apec.fr/offre/airbus" }, title: "Contrôleuse de gestion", content: "Contrôle de gestion industriel.", employer: "Airbus" });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    const saved = await applications.save(marie, { jobOfferId: captured.jobOffer.id, profileId });
    if (!saved.ok) throw new Error("fixture Application refused");
    applicationId = saved.application.id;
    await applications.change(marie, applicationId, { status: "applied" });
    const { rows } = await database.query<{ id: string }>(`INSERT INTO coach_conversation (candidate_id, title) VALUES ($1, 'Mon agenda') RETURNING id`, [marie]);
    conversationId = rows[0]!.id;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  describe(`${AGENDA_ACTIONS.add}`, () => {
    const args = () => ({ applicationId, scheduledAt: "2026-11-12T14:00", durationMinutes: 45, format: "video", place: "https://meet.example.com/abc" });

    it("on an Application not at « Entretien »: one card listing both changes, the Interview at its absolute date and moving the Application to « Entretien »; nothing written", async () => {
      const card = await cardFor(AGENDA_ACTIONS.add, args());

      expect(card.change).toMatchObject({
        target: { kind: "application", id: applicationId, name: "Contrôleuse de gestion · Airbus", href: `/candidatures/${applicationId}/entretiens` },
        what: "Nouvel entretien",
        before: "Aucun",
        after: "jeudi 12 novembre 2026 à 14:00 · 45 min · Visio · https://meet.example.com/abc",
        also: [{ what: "Statut de la candidature", before: "Postulée", after: "Entretien" }],
        value: { scheduledAt: "2026-11-12T14:00", durationMinutes: "45", format: "video", place: "https://meet.example.com/abc" },
      });
      expect(card.change.fields.map((field) => [field.name, field.type])).toEqual([
        ["scheduledAt", "datetime"],
        ["durationMinutes", "number"],
        ["format", "select"],
        ["place", "text"],
      ]);
      expect(await application()).toMatchObject({ status: "applied", interviews: [] });
    });

    it("on an Application at « Entretien »: one change only", async () => {
      await applications.change(marie, applicationId, { status: "interview" });

      const card = await cardFor(AGENDA_ACTIONS.add, args());

      expect(card.change).not.toHaveProperty("also");
    });

    it("« Appliquer » adds the Interview and moves the Application to « Entretien », both keeping the Origin; « Annuler » puts the state before back", async () => {
      const card = await cardFor(AGENDA_ACTIONS.add, args());

      expect(await actionCards.decide(marie, card.id, "accept")).toMatchObject({ ok: true, card: { status: "accepted", undoable: true } });
      expect(await application()).toMatchObject({
        status: "interview",
        statusOrigin: origin(card.id),
        interviews: [{ scheduledAt: new Date("2026-11-12T13:00:00.000Z"), durationMinutes: 45, format: "video", place: "https://meet.example.com/abc", origin: origin(card.id) }],
      });

      const undone = await actionCards.undo(marie, card.id);
      expect(undone).toMatchObject({ ok: true, card: { status: "undone" } });
      expect(undone.ok && undone.card).not.toHaveProperty("undoNote");
      expect(await application()).toMatchObject({ status: "applied", interviews: [] });
      expect(await application()).not.toHaveProperty("statusOrigin");
    });

    it("applies the date the Candidate set in « Modifier avant d'appliquer », checked as the Interview form checks it", async () => {
      const card = await cardFor(AGENDA_ACTIONS.add, args());

      expect(await actionCards.decide(marie, card.id, "accept", { edited: { scheduledAt: "pas une date" } })).toEqual({ ok: false, error: "invalid", errors: [{ field: "scheduledAt", code: "invalid" }] });
      expect(await actionCards.decide(marie, card.id, "accept", { edited: { scheduledAt: "2026-11-13T09:30", durationMinutes: "", format: "" } })).toMatchObject({ ok: true });

      expect((await application()).interviews).toMatchObject([{ scheduledAt: new Date("2026-11-13T08:30:00.000Z"), durationMinutes: null, format: null }]);
    });

    it("refuses « Appliquer » as a conflict once the Application Status moved on since the proposal", async () => {
      const card = await cardFor(AGENDA_ACTIONS.add, args());
      await applications.change(marie, applicationId, { status: "rejected" }); // on its page, meanwhile

      expect(await actionCards.decide(marie, card.id, "accept")).toEqual({ ok: false, error: "conflict" });
      expect(await application()).toMatchObject({ status: "rejected", interviews: [] });
    });

    it("« Annuler » once the Application Status changed since: the Interview removed, the status left as it is, and the card says so (#770)", async () => {
      const card = await cardFor(AGENDA_ACTIONS.add, args());
      await actionCards.decide(marie, card.id, "accept");
      await applications.change(marie, applicationId, { status: "offer_received" }); // on its page, meanwhile

      expect(await actionCards.undo(marie, card.id)).toMatchObject({ ok: true, card: { status: "undone", undoNote: "status_kept" } });
      expect(await application()).toMatchObject({ status: "offer_received", interviews: [] });
    });

    it("« Annuler » puts both back in one transaction: a status change waiting on the Application lands after it, never in between (#770)", async () => {
      const card = await cardFor(AGENDA_ACTIONS.add, args());
      await actionCards.decide(marie, card.id, "accept");
      // Another transaction holds the Application while « Annuler » runs: « Annuler » waits for it, then sees its change.
      const other = await database.connect();
      try {
        await other.query("BEGIN");
        await other.query(`UPDATE application SET status = 'offer_received', status_changed_at = now() + interval '1 second', status_origin = NULL WHERE id = $1`, [applicationId]);
        const undoing = actionCards.undo(marie, card.id);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await other.query("COMMIT");
        expect(await undoing).toMatchObject({ ok: true, card: { undoNote: "status_kept" } });
      } finally {
        other.release();
      }
      expect(await application()).toMatchObject({ status: "offer_received", interviews: [] });
    });

    it("refuses « Annuler » once the Interview added changed since", async () => {
      const card = await cardFor(AGENDA_ACTIONS.add, args());
      await actionCards.decide(marie, card.id, "accept");
      const [interview] = (await application()).interviews;
      await applications.editInterview(marie, applicationId, interview!.id, { note: "Avec la DRH" });

      expect(await actionCards.undo(marie, card.id)).toEqual({ ok: false, error: "conflict" });
      expect((await application()).interviews).toHaveLength(1);
    });

    it("finds nothing of another Candidate's, nor of an Archived Profile's Application", async () => {
      expect(await run(AGENDA_ACTIONS.add, args(), paul)).toEqual({ ok: false, error: "not_found" });
      await profiles.archive(marie, profileId);
      expect(await run(AGENDA_ACTIONS.add, args())).toEqual({ ok: false, error: "not_found" });
    });

    it("writes its card in the Candidate's language", async () => {
      const ran = await run(AGENDA_ACTIONS.add, args(), marie, "en");

      expect(ran).toMatchObject({ ok: true, data: { what: "New interview", before: "None", after: "Thursday, 12 November 2026 at 14:00 · 45 min · Video call · https://meet.example.com/abc" } });
    });
  });

  describe(`${AGENDA_ACTIONS.change}`, () => {
    it("a new date: the Interview moved, a Reschedule as the hour rule says; « Annuler » within the hour leaves no trace", async () => {
      const interviewId = await enteredInterview();
      const card = await cardFor(AGENDA_ACTIONS.change, { applicationId, interviewId, scheduledAt: "2026-11-13T10:00", format: "video", place: "https://meet.example.com/xyz" });

      expect(card.change).toMatchObject({
        what: "Entretien",
        before: "jeudi 12 novembre 2026 à 14:00 · 60 min · Sur place · Siège, Toulouse",
        after: "vendredi 13 novembre 2026 à 10:00 · 60 min · Visio · https://meet.example.com/xyz",
        value: { scheduledAt: "2026-11-13T10:00", durationMinutes: "60", format: "video", place: "https://meet.example.com/xyz" },
      });
      await actionCards.decide(marie, card.id, "accept");
      const [moved] = (await application()).interviews;
      expect(moved).toMatchObject({ scheduledAt: new Date("2026-11-13T09:00:00.000Z"), format: "video", origin: origin(card.id), reschedules: [{ previousAt: new Date("2026-11-12T13:00:00.000Z") }] });

      later(20);
      expect(await actionCards.undo(marie, card.id)).toMatchObject({ ok: true });
      const [back] = (await application()).interviews;
      expect(back).toMatchObject({ scheduledAt: new Date("2026-11-12T13:00:00.000Z"), format: "on_site", place: "Siège, Toulouse", reschedules: [] });
      expect(back).not.toHaveProperty("origin");
    });

    it("« Annuler » more than an hour later: the date back, the Reschedule kept in the history", async () => {
      const interviewId = await enteredInterview();
      const card = await cardFor(AGENDA_ACTIONS.change, { applicationId, interviewId, scheduledAt: "2026-11-13T10:00" });
      await actionCards.decide(marie, card.id, "accept");
      later(2 * 60);

      await actionCards.undo(marie, card.id);

      const [back] = (await application()).interviews;
      expect(back!.scheduledAt).toEqual(new Date("2026-11-12T13:00:00.000Z"));
      expect(back!.reschedules).toHaveLength(2);
    });

    it("finds nothing of another Candidate's Interview, nor one of another Application", async () => {
      const interviewId = await enteredInterview();

      expect(await run(AGENDA_ACTIONS.change, { applicationId, interviewId, scheduledAt: "2026-11-13T10:00" }, paul)).toEqual({ ok: false, error: "not_found" });
      expect(await run(AGENDA_ACTIONS.change, { applicationId: "00000000-0000-4000-8000-000000000000", interviewId, scheduledAt: "2026-11-13T10:00" })).toEqual({ ok: false, error: "not_found" });
    });

    it("refuses « Appliquer » as a conflict once the Interview changed since the proposal", async () => {
      const interviewId = await enteredInterview();
      const card = await cardFor(AGENDA_ACTIONS.change, { applicationId, interviewId, scheduledAt: "2026-11-13T10:00" });
      await applications.editInterview(marie, applicationId, interviewId, { place: "Blagnac" }); // on its page, meanwhile

      expect(await actionCards.decide(marie, card.id, "accept")).toEqual({ ok: false, error: "conflict" });
      expect((await application()).interviews[0]).toMatchObject({ scheduledAt: new Date("2026-11-12T13:00:00.000Z"), place: "Blagnac" });
    });
  });

  describe(`${AGENDA_ACTIONS.cancel}`, () => {
    it("a Cancelled Agenda Item: « Appliquer » cancels the Interview, which stays; « Annuler » plans it again as it was", async () => {
      const interviewId = await enteredInterview();
      const card = await cardFor(AGENDA_ACTIONS.cancel, { applicationId, interviewId });

      expect(card.change).toMatchObject({ what: "Entretien", before: "jeudi 12 novembre 2026 à 14:00 · 60 min · Sur place · Siège, Toulouse", after: "Annulé", fields: [] });
      await actionCards.decide(marie, card.id, "accept");
      expect((await application()).interviews).toMatchObject([{ id: interviewId, cancelledAt: now, origin: origin(card.id) }]);

      await actionCards.undo(marie, card.id);
      expect((await application()).interviews).toMatchObject([{ id: interviewId, cancelledAt: null }]);
    });

    it("finds nothing to cancel in an Interview already cancelled", async () => {
      const interviewId = await enteredInterview();
      await applications.cancelInterview(marie, applicationId, interviewId);

      expect(await run(AGENDA_ACTIONS.cancel, { applicationId, interviewId })).toEqual({ ok: false, error: "not_found" });
    });
  });
});
