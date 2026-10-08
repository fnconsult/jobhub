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

  const followUpFocus = () => ({ kind: "application", id: applicationId }) as const;
  const pendingCards = (owner = candidateId) => actionCards.pending(owner, followUpFocus());

  beforeEach(async () => {
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
});
