import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActionCards, migrateActionCards, type ActionCards } from "../action-cards";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles } from "../profiles";
import { migrateTailoredDocuments } from "../tailored-documents";
import { ABANDON_CARD, FOLLOW_UP_CARD, createFollowUps, migrateFollowUps, type FollowUps } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};

/** French time, noon: clear of any midnight in Europe/Paris. */
const day = (date: string) => new Date(`${date}T12:00:00+01:00`);

describe.skipIf(!connectionString)("Follow-ups (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let applications: Applications;
  let actionCards: ActionCards;
  let followUps: FollowUps;
  let candidateId: string;
  let otherCandidateId: string;
  let applicationId: string;
  let clock: Date;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  /** Arrange only: the Candidate set this status on that day (the Applications module stamps the real time). */
  async function setStatus(status: string, on: Date, id = applicationId, owner = candidateId) {
    const changed = await applications.change(owner, id, { status });
    if (!changed.ok) throw new Error("fixture status refused");
    await database.query(`UPDATE application SET status_changed_at = $2 WHERE id = $1`, [id, on]);
  }

  /** The Candidate marks the pending Follow-up as sent on that day. */
  async function markSentOn(on: Date) {
    const [card] = await pendingCards();
    if (!card || card.kind !== FOLLOW_UP_CARD) throw new Error("no Follow-up pending");
    const statusBefore = (await applications.get(candidateId, applicationId))?.status;
    clock = on;
    expect(await actionCards.decide(candidateId, card.id, "accept")).toMatchObject({ ok: true });
    // Arrange only: the Applications module stamps a status change with the real time.
    if (statusBefore !== "followed_up") await database.query(`UPDATE application SET status_changed_at = $2 WHERE id = $1`, [applicationId, on]);
  }

  const followUpFocus = () => ({ kind: "application", id: applicationId }) as const;
  const pendingCards = (owner = candidateId) => actionCards.pending(owner, followUpFocus());

  beforeEach(async () => {
    clock = new Date();
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateTailoredDocuments(database);
    await migrateActionCards(database);
    await migrateFollowUps(database);
    await migrateFollowUps(database); // safe to run twice
    const profiles = createProfiles(database);
    const jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    followUps = createFollowUps(database, {
      actionCards: createActionCards(database),
      applications,
      mailer: { send: async (message) => void testAuth.mailbox.push(message) },
      appUrl: "https://app.jobbbox.test",
      now: () => clock,
    });
    actionCards = createActionCards(database, { onAccept: followUps.onAccept });
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
    const profile = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
    const captured = await jobOffers.capture({
      source: { url: "https://www.apec.fr/offre/1" },
      title: "DAF H/F",
      content: "Nous recherchons un DAF pour un groupe industriel. Vous avez 15 ans d'expérience dans la finance.",
      employer: "Acme Industrie",
      location: "Lyon",
    });
    if (!profile.ok || !captured.ok) throw new Error("fixtures refused");
    const saved = await applications.save(candidateId, { jobOfferId: captured.jobOffer.id, profileId: profile.profile.id });
    if (!saved.ok) throw new Error("fixture Application refused");
    applicationId = saved.application.id;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("proposes a Follow-up draft on the Application once it has stayed « Postulée » 7 working days, French public holidays excluded", async () => {
    // Monday 2 November 2026; Wednesday 11 November is a public holiday, so the 7th working day is Thursday 12.
    await setStatus("applied", day("2026-11-02"));

    await followUps.proposeDue(day("2026-11-11"));
    expect(await pendingCards()).toEqual([]);

    await followUps.proposeDue(day("2026-11-12"));
    const cards = await pendingCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: FOLLOW_UP_CARD, focus: followUpFocus() });
    expect(cards[0]!.title).toContain("DAF H/F");
    expect(cards[0]!.body).not.toBe("");
  });

  it("moves the Application to « Relancée » when the Candidate marks the Follow-up as sent, then proposes the next one 10 working days later", async () => {
    await setStatus("applied", day("2026-11-02"));
    await followUps.proposeDue(day("2026-11-12"));

    await markSentOn(day("2026-11-12"));
    expect((await applications.get(candidateId, applicationId))?.status).toBe("followed_up");
    expect(await pendingCards()).toEqual([]);

    // 10 working days after Thursday 12 November: Thursday 26 November.
    await followUps.proposeDue(day("2026-11-25"));
    expect(await pendingCards()).toEqual([]);
    await followUps.proposeDue(day("2026-11-26"));
    expect(await pendingCards()).toMatchObject([{ kind: FOLLOW_UP_CARD }]);
  });

  it("suggests « Abandonnée » once the second Follow-up has stayed unanswered as long, and abandons the Application if the Candidate accepts", async () => {
    await setStatus("applied", day("2026-11-02"));
    await followUps.proposeDue(day("2026-11-12"));
    await markSentOn(day("2026-11-12"));
    await followUps.proposeDue(day("2026-11-26"));
    await markSentOn(day("2026-11-26"));

    await followUps.proposeDue(day("2026-12-10"));
    const [card] = await pendingCards();
    expect(card).toMatchObject({ kind: ABANDON_CARD });
    expect((await applications.get(candidateId, applicationId))?.status).toBe("followed_up");

    await actionCards.decide(candidateId, card!.id, "accept");
    expect((await applications.get(candidateId, applicationId))?.status).toBe("abandoned");
  });

  it("proposes each Follow-up once: not again while it is pending, nor after the Candidate dismissed it", async () => {
    await setStatus("applied", day("2026-11-02"));
    await followUps.proposeDue(day("2026-11-12"));
    await followUps.proposeDue(day("2026-11-13"));
    const cards = await pendingCards();
    expect(cards).toHaveLength(1);

    await actionCards.decide(candidateId, cards[0]!.id, "dismiss");
    await followUps.proposeDue(day("2026-11-20"));
    expect(await pendingCards()).toEqual([]);
    expect((await applications.get(candidateId, applicationId))?.status).toBe("applied");
  });

  it("counts a « Relancée » the Candidate set by hand as a Follow-up sent, waiting 10 working days from it", async () => {
    await setStatus("followed_up", day("2026-11-12"));

    await followUps.proposeDue(day("2026-11-25"));
    expect(await pendingCards()).toEqual([]);
    await followUps.proposeDue(day("2026-11-26"));
    expect(await pendingCards()).toMatchObject([{ kind: FOLLOW_UP_CARD }]);
    await markSentOn(day("2026-11-26"));

    await followUps.proposeDue(day("2026-12-10"));
    expect(await pendingCards()).toMatchObject([{ kind: ABANDON_CARD }]);
  });

  it("proposes nothing once the Application has moved on (e.g. « Entretien »)", async () => {
    await setStatus("interview", day("2026-11-02"));

    await followUps.proposeDue(day("2027-01-04"));

    expect(await pendingCards()).toEqual([]);
  });
});
