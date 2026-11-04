import { applicationResponseSchema, applicationsResponseSchema, jobDigestsResponseSchema, jobSearchesResponseSchema, jobSearchResponseSchema } from "@jobhub/shared/reads";
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createActionCards } from "../action-cards";
import { createApplications, type Applications } from "../applications";
import { BASE_URL, connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createBilling } from "../billing";
import { createReceivedOffers } from "../email-intake/received-offers";
import { createFollowUps } from "../follow-ups";
import { createJobDigests, type JobDigests } from "../job-digests";
import { createJobOffers, type JobOffers } from "../job-offers";
import { createJobSearches, type JobSearches } from "../job-searches";
import { migrateDatabase } from "../migrations";
import { createProfiles, type Profiles } from "../profiles";
import { createCandidateReads, type CandidateReads } from "./index";

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

/** Today, in the tests: a Wednesday in French winter time. */
const NOW = new Date("2026-11-04T09:00:00.000Z");

/**
 * What the app reads: the answer as it crosses HTTP (JSON), parsed with its shared schema. The parse throws, naming
 * the field, when the answer drifts from the type the app is built on: the contract test of #684.
 */
function overHttp<S extends z.ZodType>(schema: S, answer: unknown): z.output<S> {
  return schema.parse(JSON.parse(JSON.stringify(answer)));
}

describe.skipIf(!connectionString)("The Candidate's reads over HTTP, the Jobbbox app's GETs (#684; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let jobSearches: JobSearches;
  let jobDigests: JobDigests;
  let reads: CandidateReads;
  let marie: string;
  let paul: string;
  let offers: number;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function createProfile(owner: string, targetRole = "DAF") {
    const created = await profiles.create(owner, { masterCv, searchCriteria: { targetRole, locations: ["Lyon"], contractTypes: ["cdi"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    return created.profile.id;
  }

  async function captureOffer(title = "DAF H/F") {
    offers++;
    const captured = await jobOffers.capture({
      source: { url: `https://carrieres.example.fr/daf/${offers}` },
      title,
      content: `${title} (${offers}) pour un groupe industriel. Vous pilotez la consolidation IFRS sous SAP.`,
      employer: "Acme Industrie",
      location: "Lyon",
      contractType: "cdi",
      skills: ["IFRS", "SAP"],
    });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    return captured.jobOffer.id;
  }

  /** A Job Search of the Profile that found `jobOfferIds`, as Job discovery reports it. */
  async function searched(owner: string, profileId: string, jobOfferIds: string[]) {
    const started = await jobSearches.start(owner, { profileId });
    if (!started.ok) throw new Error(`fixture Job Search refused: ${JSON.stringify(started)}`);
    await jobSearches.record(started.jobSearch.id, { jobOfferIds });
    return started.jobSearch.id;
  }

  /** Puts the Candidate on a Plan, as the Stripe webhook would. */
  async function onPlan(owner: string, plan: string) {
    await database.query(`INSERT INTO candidate_plan (candidate_id, plan) VALUES ($1, $2) ON CONFLICT (candidate_id) DO UPDATE SET plan = $2`, [owner, plan]);
  }

  async function saveApplication(owner: string, profileId: string, title?: string) {
    const saved = await applications.save(owner, { jobOfferId: await captureOffer(title), profileId });
    if (!saved.ok) throw new Error("fixture Application refused");
    return saved.application.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateDatabase({ database, baseURL: BASE_URL, secret: "test-secret-test-secret-test-secret-0123", mailer: { send: async () => {} } });
    offers = 0;
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    const actionCards = createActionCards(database);
    const followUps = createFollowUps(database, { actionCards, applications, mailer: { send: async () => {} }, appUrl: BASE_URL, now: () => NOW });
    const billing = createBilling({ database, baseURL: BASE_URL, now: () => NOW });
    jobSearches = createJobSearches(database, { profiles, jobOffers, applications, quotas: billing, queue: { send: async () => {} }, now: () => NOW });
    jobDigests = createJobDigests(database, {
      profiles,
      jobOffers,
      applications,
      billing,
      receivedOffers: createReceivedOffers(database, { jobOffers, profiles, applications }),
      mailer: { send: async () => {} },
      baseURL: BASE_URL,
      now: () => NOW,
    });
    reads = createCandidateReads({ applications, followUps, profiles, jobSearches, jobDigests, now: () => NOW });
    marie = await signIn("marie.dupont@example.fr");
    paul = await signIn("paul.martin@example.fr");
  }, 60_000); // A throwaway database each time: slow when the machine is busy.
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  describe("Mes candidatures", () => {
    it("lists the Applications with their status, Match Score, à traiter and next deadline, as the shared type says", async () => {
      const profileId = await createProfile(marie);
      const waiting = await saveApplication(marie, profileId, "Contrôleur de gestion");
      const interviewing = await saveApplication(marie, profileId);
      await applications.addInterview(marie, interviewing, { scheduledAt: "2026-11-02T10:00", moveToInterview: true });
      await applications.addInterview(marie, interviewing, { scheduledAt: "2026-11-12T14:30", note: "avec la DRH" });

      const card = overHttp(applicationsResponseSchema, await reads.applications(marie));

      expect(card.applications.map((row) => row.id)).toEqual([interviewing, waiting]);
      expect(card.applications[0]).toMatchObject({
        title: "DAF H/F",
        employer: "Acme Industrie",
        status: "interview",
        matchScore: expect.any(Number),
        toHandle: null,
        // The next Interview from now on, not the one already held: 14:30 in Paris is 13:30 UTC in November.
        nextDeadline: "2026-11-12T13:30:00.000Z",
        expired: false,
        archived: false,
      });
      expect(card.applications[1]).toMatchObject({ status: "to_apply", nextDeadline: null });
      expect(card).toMatchObject({ toHandle: 0, archivedHidden: 0 });
    });

    it("leaves the Archived Applications out until asked for, as the card does", async () => {
      const archivedProfile = await createProfile(marie, "Contrôleur de gestion");
      const archived = await saveApplication(marie, archivedProfile);
      await profiles.archive(marie, archivedProfile);

      expect(overHttp(applicationsResponseSchema, await reads.applications(marie))).toMatchObject({ applications: [], archivedHidden: 1 });
      const shown = overHttp(applicationsResponseSchema, await reads.applications(marie, { showArchived: true }));
      expect(shown.applications).toEqual([expect.objectContaining({ id: archived, archived: true })]);
    });

    it("gives one Application with its Interviews, a Cancelled one included", async () => {
      const profileId = await createProfile(marie);
      const id = await saveApplication(marie, profileId);
      const added = await applications.addInterview(marie, id, { scheduledAt: "2026-11-12T14:30", durationMinutes: 45, format: "video", place: "https://meet.example.com/abc", moveToInterview: true });
      if (!added.ok) throw new Error("fixture Interview refused");
      await applications.cancelInterview(marie, id, added.application.interviews[0]!.id);

      const application = overHttp(applicationResponseSchema, await reads.application(marie, id));

      expect(application).toMatchObject({ id, status: "interview", jobOffer: { title: "DAF H/F", employer: "Acme Industrie" }, profile: { id: profileId, name: "DAF" } });
      expect(application.interviews).toEqual([
        {
          id: added.application.interviews[0]!.id,
          scheduledAt: "2026-11-12T13:30:00.000Z",
          durationMinutes: 45,
          format: "video",
          place: "https://meet.example.com/abc",
          note: "",
          cancelledAt: expect.any(String),
          reschedules: [],
        },
      ]);
    });

    it("never gives a Candidate another Candidate's Application", async () => {
      const marieApplication = await saveApplication(marie, await createProfile(marie));
      await saveApplication(paul, await createProfile(paul));

      expect(await reads.application(paul, marieApplication)).toBeNull();
      expect(overHttp(applicationsResponseSchema, await reads.applications(paul)).applications.map((row) => row.id)).not.toContain(marieApplication);
    });
  });

  describe("Recherches d'offres", () => {
    it("gives each active Profile's Job Searches, an Archived Profile's left out, as the card does", async () => {
      const daf = await createProfile(marie);
      const archived = await createProfile(marie, "Contrôleur de gestion");
      await onPlan(marie, "premium");
      const search = await searched(marie, daf, [await captureOffer()]);
      await searched(marie, archived, [await captureOffer("Contrôleur de gestion")]);
      await profiles.archive(marie, archived);

      const card = overHttp(jobSearchesResponseSchema, await reads.jobSearches(marie));

      expect(card.profiles).toEqual([
        { profile: { id: daf, name: "DAF" }, searches: [{ id: search, status: "done", startedAt: NOW.toISOString(), found: 1, unseen: true }] },
      ]);
      expect(card.unseen).toBe(1);
    });

    it("gives a Job Search's Job Offers with their Match Score, kept once saved as an Application", async () => {
      const daf = await createProfile(marie);
      const kept = await captureOffer();
      const undecided = await captureOffer("Directeur financier");
      const search = await searched(marie, daf, [kept, undecided]);
      const saved = await applications.save(marie, { jobOfferId: kept, profileId: daf });
      if (!saved.ok) throw new Error("fixture Application refused");

      const read = overHttp(jobSearchResponseSchema, await reads.jobSearch(marie, search));

      expect(read).toMatchObject({ id: search, profile: { id: daf, name: "DAF" }, status: "done", failure: null });
      expect(read.jobOffers).toHaveLength(2);
      expect(read.jobOffers.find((found) => found.jobOffer.id === kept)).toMatchObject({ decision: "kept", applicationId: saved.application.id, matchScore: expect.any(Number) });
      expect(read.jobOffers.find((found) => found.jobOffer.id === undecided)).toMatchObject({ decision: null, applicationId: null, jobOffer: { title: "Directeur financier", employer: "Acme Industrie" } });
    });

    it("never gives a Candidate another Candidate's Job Search", async () => {
      const search = await searched(marie, await createProfile(marie), [await captureOffer()]);
      await createProfile(paul);

      expect(await reads.jobSearch(paul, search)).toBeNull();
      expect(overHttp(jobSearchesResponseSchema, await reads.jobSearches(paul)).profiles.flatMap((group) => group.searches)).toEqual([]);
    });
  });

  describe("Job Digests", () => {
    it("gives each active Profile's frequency and the Job Digests sent, as the card does", async () => {
      await onPlan(marie, "standard");
      const daf = await createProfile(marie);
      const subscribed = await jobDigests.subscribe(marie, daf, "weekly");
      if (!subscribed.ok) throw new Error("fixture subscription refused");
      const found = await captureOffer();
      const delivered = await jobDigests.deliver(marie, daf, async () => ({ jobOfferIds: [found], provenance: null }));
      if (!delivered.digest) throw new Error("fixture Job Digest not sent");

      const card = overHttp(jobDigestsResponseSchema, await reads.jobDigests(marie));

      expect(card.profiles).toEqual([
        {
          profile: { id: daf, name: "DAF" },
          frequency: "weekly",
          chosenFrequency: "weekly",
          planFrequency: "weekly",
          digests: [{ id: delivered.digest.id, sentAt: expect.any(String), count: delivered.digest.results.length }],
        },
      ]);
    });

    it("leaves out an Archived Profile, and says « none » for a Profile not opted in", async () => {
      const daf = await createProfile(marie);
      const archived = await createProfile(marie, "Contrôleur de gestion");
      await profiles.archive(marie, archived);

      const card = overHttp(jobDigestsResponseSchema, await reads.jobDigests(marie));

      expect(card.profiles).toEqual([{ profile: { id: daf, name: "DAF" }, frequency: "none", chosenFrequency: null, planFrequency: "none", digests: [] }]);
    });
  });
});
