import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActionCards, migrateActionCards, migrateActionCardsInThread, type ActionCards } from "../action-cards";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import type { CoachFocus } from "../coach/context";
import { coachProposalHandlers, createCoachProposals, type CoachProposals } from "../coach-proposals";
import { migrateCoachConversations } from "../coach-conversations";
import { createFollowUps, migrateFollowUps, type FollowUps } from "../follow-ups";
import { migrateJobDigests } from "../job-digests";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { migrateJobSearches } from "../job-searches";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { applicationCoachActions, PROPOSE_APPLICATION, PROPOSE_APPLICATION_PROFILE, PROPOSE_APPLICATION_STATUS, PROPOSE_FOLLOW_UP_SENT } from "./applications";
import type { CoachAction, CoachActionResult } from "./index";

// The Candidatures Coach Actions (#716, ADR-0077) over the real Applications and Follow-ups modules: what each proposes
// (its scope: the session's Candidate's objects only, Archived Applications out of reach), what « Appliquer » changes
// (from the version seen: a conflict once it moved on) and what « Annuler » puts back, through the cards in the thread.

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

describe.skipIf(!connectionString)("the Candidatures Coach Actions (#716, needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let followUps: FollowUps;
  let catalog: CoachAction[];
  let actionCards: ActionCards;
  let proposals: CoachProposals;
  let marie: string;
  let paul: string;
  let daf: string;
  let consultant: string;
  let archived: string;
  /** Marie's Application with « DAF », « Postulée ». */
  let applicationId: string;
  /** Marie's Application with her archived Profile: an Archived Application. */
  let archivedApplicationId: string;
  /** A Job Offer Marie has not saved yet, which her Job Search found. */
  let newOfferId: string;
  /** A Job Offer none of Marie's objects shows. */
  let strangerOfferId: string;
  let conversationId: string;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function profile(owner: string, targetRole: string) {
    const created = await profiles.create(owner, { masterCv, searchCriteria: { targetRole, locations: ["Lyon"], contractTypes: ["cdi"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    await database.query(`UPDATE profile SET name = $2 WHERE id = $1`, [created.profile.id, targetRole]);
    return created.profile.id;
  }

  async function offer(n: number, title: string, employer: string) {
    const captured = await jobOffers.capture({ source: { url: `https://www.apec.fr/offre/${n}` }, title, content: `${title} pour un groupe industriel.`, employer });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    return captured.jobOffer.id;
  }

  async function saved(jobOfferId: string, profileId: string, status?: string) {
    const result = await applications.save(marie, { jobOfferId, profileId });
    if (!result.ok) throw new Error("fixture Application refused");
    if (status) await applications.change(marie, result.application.id, { status });
    return result.application.id;
  }

  const action = (name: string) => catalog.find((each) => each.name === name)!;
  const run = (name: string, args: Record<string, unknown>, options: { owner?: string; inView?: CoachFocus; language?: "fr" | "en" } = {}): Promise<CoachActionResult> =>
    action(name).run(args, { candidateId: options.owner ?? marie, language: options.language ?? "fr", ...(options.inView ? { inView: options.inView } : {}) });

  /** Proposes through `name` and places the card under a new reply: the card's id. */
  async function card(name: string, args: Record<string, unknown>, inView?: CoachFocus): Promise<string> {
    const ran = await run(name, args, inView ? { inView } : {});
    if (!ran.ok) throw new Error(`${name} proposed nothing`);
    const { rows } = await database.query<{ seq: string }>(`INSERT INTO coach_message (conversation_id, author, text) VALUES ($1, 'coach', 'Je vous le propose.') RETURNING seq`, [conversationId]);
    const [placed] = await proposals.place(marie, { reply: rows[0]!.seq, earlier: [] }, [{ action: name, group: "applications", data: ran.data }]);
    if (!placed) throw new Error("no card placed");
    return placed.id;
  }

  const statusOf = async (id = applicationId) => (await applications.statusOf(marie, id))?.status;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateJobSearches(database);
    await migrateJobDigests(database);
    await migrateActionCards(database);
    await migrateFollowUps(database);
    await migrateCoachConversations(database);
    await migrateActionCardsInThread(database);
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    followUps = createFollowUps(database, { actionCards: createActionCards(database), applications, mailer: { send: async () => {} }, appUrl: "https://app.jobbbox.test" });
    marie = await signIn("marie.dupont@example.fr");
    paul = await signIn("paul.martin@example.fr");
    daf = await profile(marie, "DAF");
    consultant = await profile(marie, "Consultante finance");
    archived = await profile(marie, "Ancien profil");
    applicationId = await saved(await offer(1, "DAF H/F", "Acme Industrie"), daf, "applied");
    archivedApplicationId = await saved(await offer(2, "Contrôleuse de gestion", "Globex"), archived);
    await profiles.archive(marie, archived);
    newOfferId = await offer(3, "Directrice financière de transition", "Société Fictive");
    strangerOfferId = await offer(4, "DSI", "Initech");
    const reached = new Set([newOfferId]);
    catalog = applicationCoachActions({ applications, profiles, jobOffers, followUps, reachesJobOffer: async (candidateId, id) => candidateId === marie && reached.has(id) });
    actionCards = createActionCards(database, coachProposalHandlers(catalog, () => new Date("2026-11-05T09:30:00Z")));
    proposals = createCoachProposals({ catalog, actionCards });
    const { rows } = await database.query<{ id: string }>(`INSERT INTO coach_conversation (candidate_id, title) VALUES ($1, 'Mes candidatures') RETURNING id`, [marie]);
    conversationId = rows[0]!.id;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("are four proposing Coach Actions of the Candidatures group, none copying text", () => {
    expect(catalog.map((each) => [each.name, each.group, each.kind, each.copiesText, typeof each.apply, typeof each.undo])).toEqual([
      [PROPOSE_APPLICATION, "applications", "propose", false, "function", "function"],
      [PROPOSE_APPLICATION_STATUS, "applications", "propose", false, "function", "function"],
      [PROPOSE_APPLICATION_PROFILE, "applications", "propose", false, "function", "function"],
      [PROPOSE_FOLLOW_UP_SENT, "applications", "propose", false, "function", "function"],
    ]);
  });

  describe("propose_application", () => {
    it("proposes to save the Job Offer In view with the first active Profile, the Candidate's active Profiles to choose from; nothing saved", async () => {
      const ran = await run(PROPOSE_APPLICATION, {}, { inView: { kind: "job_offer", id: strangerOfferId } });

      expect(ran).toEqual({
        ok: true,
        untrusted: true,
        pages: [`/offres/${strangerOfferId}`],
        data: {
          target: { kind: "job_offer", id: strangerOfferId, name: "DSI · Initech", href: `/offres/${strangerOfferId}` },
          what: "Candidature",
          before: "Offre non enregistrée",
          after: "À postuler, avec le profil « DAF »",
          value: { profileId: daf },
          fields: [{ name: "profileId", label: "Profil de la candidature", type: "select", options: [{ value: daf, label: "DAF" }, { value: consultant, label: "Consultante finance" }] }],
          version: "",
        },
      });
      expect((await applications.list(marie)).some((each) => each.jobOffer.id === strangerOfferId)).toBe(false);
    });

    it("reaches a Job Offer out of view only when one of the Candidate's objects shows it, with an active Profile of theirs", async () => {
      expect(await run(PROPOSE_APPLICATION, { jobOfferId: newOfferId, profileId: consultant }, { language: "en" })).toMatchObject({
        ok: true,
        data: { what: "Application", after: "To apply, with the profile “Consultante finance”", value: { profileId: consultant } },
      });
      expect(await run(PROPOSE_APPLICATION, { jobOfferId: strangerOfferId })).toEqual({ ok: false, error: "not_found" });
      expect(await run(PROPOSE_APPLICATION, { jobOfferId: newOfferId }, { owner: paul })).toEqual({ ok: false, error: "not_found" });
      expect(await run(PROPOSE_APPLICATION, { jobOfferId: newOfferId, profileId: archived })).toEqual({ ok: false, error: "not_found" });
      expect(await run(PROPOSE_APPLICATION, {})).toEqual({ ok: false, error: "not_found" });
    });

    it("proposes nothing for a Job Offer already saved: the AI Coach is told which Application it is, to link it", async () => {
      const jobOfferId = (await applications.get(marie, applicationId))!.jobOffer.id;

      const ran = await run(PROPOSE_APPLICATION, {}, { inView: { kind: "job_offer", id: jobOfferId } });

      expect(ran).toMatchObject({ ok: true, proposes: false, pages: [`/candidatures/${applicationId}`], data: { applicationId, href: `/candidatures/${applicationId}`, message: expect.stringContaining("déjà enregistrée") } });
    });

    it("« Appliquer » saves it with its Origin, as the Candidate left the Profile; « Annuler » removes it while nothing was added to it", async () => {
      const id = await card(PROPOSE_APPLICATION, {}, { kind: "job_offer", id: strangerOfferId });

      expect(await actionCards.decide(marie, id, "accept", { edited: { profileId: consultant } })).toMatchObject({ ok: true, card: { status: "accepted", undoable: true } });
      const created = (await applications.list(marie)).find((each) => each.jobOffer.id === strangerOfferId)!;
      expect(created).toMatchObject({ status: "to_apply", profile: { id: consultant } });
      expect((await applications.get(marie, created.id))?.statusOrigin).toEqual({ origin: "coach_proposal", cardId: id, appliedAt: new Date("2026-11-05T09:30:00Z") });

      expect(await actionCards.undo(marie, id)).toMatchObject({ ok: true, card: { status: "undone" } });
      expect(await applications.get(marie, created.id)).toBeNull();
    });

    it("is a conflict when the Job Offer was saved meanwhile; « Annuler » is refused once something was added to the Application", async () => {
      const first = await card(PROPOSE_APPLICATION, {}, { kind: "job_offer", id: strangerOfferId });
      const second = await card(PROPOSE_APPLICATION, { jobOfferId: newOfferId });
      await saved(strangerOfferId, daf); // from its page, meanwhile

      expect(await actionCards.decide(marie, first, "accept")).toEqual({ ok: false, error: "conflict" });
      expect(await actionCards.decide(marie, second, "accept")).toMatchObject({ ok: true });
      const created = (await applications.list(marie)).find((each) => each.jobOffer.id === newOfferId)!;
      await applications.addInterview(marie, created.id, { scheduledAt: "2026-11-12T14:30", moveToInterview: true });

      expect(await actionCards.undo(marie, second)).toEqual({ ok: false, error: "conflict" });
      expect(await applications.get(marie, created.id)).not.toBeNull();
    });

    it("refuses a Profile the Candidate chose that is not one of their active ones", async () => {
      const id = await card(PROPOSE_APPLICATION, {}, { kind: "job_offer", id: strangerOfferId });

      expect(await actionCards.decide(marie, id, "accept", { edited: { profileId: archived } })).toEqual({ ok: false, error: "invalid", errors: [{ field: "profileId", code: "invalid" }] });
    });
  });

  describe("propose_application_status", () => {
    it("proposes a new status for the Application In view or named, « Refusée » and « Abandonnée » included; nothing for the status it has", async () => {
      expect(await run(PROPOSE_APPLICATION_STATUS, { status: "abandoned" }, { inView: { kind: "application", id: applicationId } })).toMatchObject({
        ok: true,
        pages: [`/candidatures/${applicationId}`],
        data: {
          target: { kind: "application", id: applicationId, name: "DAF H/F · Acme Industrie", href: `/candidatures/${applicationId}` },
          what: "Statut de la candidature",
          before: "Postulée",
          after: "Abandonnée",
          value: { status: "abandoned" },
        },
      });
      expect(await run(PROPOSE_APPLICATION_STATUS, { applicationId, status: "rejected" })).toMatchObject({ ok: true, data: { after: "Refusée" } });
      expect(await run(PROPOSE_APPLICATION_STATUS, { applicationId, status: "applied" })).toMatchObject({ ok: true, proposes: false });
    });

    it("reaches only the Candidate's own Applications, Archived Applications excluded", async () => {
      expect(await run(PROPOSE_APPLICATION_STATUS, { applicationId, status: "interview" }, { owner: paul })).toEqual({ ok: false, error: "not_found" });
      expect(await run(PROPOSE_APPLICATION_STATUS, { applicationId: archivedApplicationId, status: "interview" })).toEqual({ ok: false, error: "not_found" });
      expect(await run(PROPOSE_APPLICATION_STATUS, { applicationId: "not-a-uuid", status: "interview" })).toEqual({ ok: false, error: "not_found" });
      expect(await run(PROPOSE_APPLICATION_STATUS, { status: "interview" })).toEqual({ ok: false, error: "not_found" });
    });

    it("« Appliquer » from the status seen, a conflict once it moved on; « Annuler » puts the status before back", async () => {
      const stale = await card(PROPOSE_APPLICATION_STATUS, { applicationId, status: "interview" });
      const id = await card(PROPOSE_APPLICATION_STATUS, { applicationId, status: "rejected" });

      expect(await actionCards.decide(marie, id, "accept")).toMatchObject({ ok: true });
      expect(await statusOf()).toBe("rejected");
      expect(await actionCards.decide(marie, stale, "accept")).toEqual({ ok: false, error: "conflict" });

      expect(await actionCards.undo(marie, id)).toMatchObject({ ok: true });
      expect(await applications.statusOf(marie, applicationId)).toMatchObject({ status: "applied", origin: null });
    });
  });

  describe("propose_application_profile", () => {
    it("proposes another of the Candidate's active Profiles; nothing for the Profile it uses; none archived nor anyone else's", async () => {
      expect(await run(PROPOSE_APPLICATION_PROFILE, { profileId: consultant }, { inView: { kind: "application", id: applicationId } })).toMatchObject({
        ok: true,
        data: { what: "Profil de la candidature", before: "DAF", after: "Consultante finance", value: { profileId: consultant }, version: daf },
      });
      expect(await run(PROPOSE_APPLICATION_PROFILE, { applicationId, profileId: daf })).toMatchObject({ ok: true, proposes: false });
      expect(await run(PROPOSE_APPLICATION_PROFILE, { applicationId, profileId: archived })).toEqual({ ok: false, error: "not_found" });
      expect(await run(PROPOSE_APPLICATION_PROFILE, { applicationId, profileId: consultant }, { owner: paul })).toEqual({ ok: false, error: "not_found" });
      expect(await run(PROPOSE_APPLICATION_PROFILE, { applicationId: archivedApplicationId, profileId: consultant })).toEqual({ ok: false, error: "not_found" });
    });

    it("« Appliquer » keeps its Origin, a conflict once the Profile changed; « Annuler » puts the Profile before back, refused once it changed since", async () => {
      const id = await card(PROPOSE_APPLICATION_PROFILE, { applicationId, profileId: consultant });
      const stale = await card(PROPOSE_APPLICATION_PROFILE, { applicationId, profileId: consultant });

      expect(await actionCards.decide(marie, id, "accept")).toMatchObject({ ok: true });
      expect(await applications.profileOf(marie, applicationId)).toEqual({ profileId: consultant, origin: expect.objectContaining({ cardId: id }) });
      // The first card withdrew nothing: both waited; the second now proposes what is already there, from a Profile that moved on.
      expect(await actionCards.decide(marie, stale, "accept")).toEqual({ ok: false, error: "conflict" });

      expect(await actionCards.undo(marie, id)).toMatchObject({ ok: true });
      expect(await applications.profileOf(marie, applicationId)).toEqual({ profileId: daf, origin: null });

      const again = await card(PROPOSE_APPLICATION_PROFILE, { applicationId, profileId: consultant });
      await actionCards.decide(marie, again, "accept");
      await applications.change(marie, applicationId, { profileId: daf }); // on its page, meanwhile
      expect(await actionCards.undo(marie, again)).toEqual({ ok: false, error: "conflict" });
    });
  });

  describe("propose_follow_up_sent", () => {
    it("proposes a Follow-up marked as sent on an Application waiting for one; nothing once two were sent, nor before it is « Postulée »", async () => {
      expect(await run(PROPOSE_FOLLOW_UP_SENT, {}, { inView: { kind: "application", id: applicationId } })).toMatchObject({
        ok: true,
        data: { what: "Relance envoyée", before: "Aucune relance envoyée", after: "1 relance envoyée, statut « Relancée »", value: {}, fields: [] },
      });
      const toApply = await saved(newOfferId, daf);
      expect(await run(PROPOSE_FOLLOW_UP_SENT, { applicationId: toApply })).toMatchObject({ ok: true, proposes: false });
      expect(await run(PROPOSE_FOLLOW_UP_SENT, { applicationId }, { owner: paul })).toEqual({ ok: false, error: "not_found" });
      expect(await run(PROPOSE_FOLLOW_UP_SENT, { applicationId: archivedApplicationId })).toEqual({ ok: false, error: "not_found" });

      for (let sent = 0; sent < 2; sent += 1) expect(await actionCards.decide(marie, await card(PROPOSE_FOLLOW_UP_SENT, { applicationId }), "accept")).toMatchObject({ ok: true });
      expect(await followUps.sentOf(marie, applicationId)).toMatchObject({ count: 2, status: "followed_up" });
      expect(await run(PROPOSE_FOLLOW_UP_SENT, { applicationId })).toMatchObject({ ok: true, proposes: false, data: { message: expect.stringContaining("Deux relances") } });
    });

    it("« Appliquer » moves it to « Relancée » with its Origin, a conflict once it moved on; « Annuler » puts it back", async () => {
      const id = await card(PROPOSE_FOLLOW_UP_SENT, { applicationId });
      const stale = await card(PROPOSE_FOLLOW_UP_SENT, { applicationId });

      expect(await actionCards.decide(marie, id, "accept")).toMatchObject({ ok: true });
      expect(await applications.statusOf(marie, applicationId)).toMatchObject({ status: "followed_up", origin: expect.objectContaining({ cardId: id }) });
      expect(await actionCards.decide(marie, stale, "accept")).toEqual({ ok: false, error: "conflict" });

      expect(await actionCards.undo(marie, id)).toMatchObject({ ok: true });
      expect(await followUps.sentOf(marie, applicationId)).toMatchObject({ count: 0, status: "applied" });
    });
  });
});
