import {
  agendaResponseSchema,
  applicationResponseSchema,
  applicationsResponseSchema,
  coachConversationResponseSchema,
  coachConversationsResponseSchema,
  coachingOrderResponseSchema,
  coachingResponseSchema, jobDigestsResponseSchema, jobSearchesResponseSchema, jobSearchResponseSchema, profileResponseSchema, profilesResponseSchema, tailoredDocumentsResponseSchema } from "@jobhub/shared/reads";
import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import { rulesProvenance, type MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createActionCards } from "../action-cards";
import { createAgenda } from "../agenda";
import { createAtsScoring, type AtsScoring } from "../ats-score";
import { createApplications, type Applications } from "../applications";
import { BASE_URL, connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createBilling } from "../billing";
import { createCoachConversations, type CoachConversations } from "../coach-conversations";
import { createReceivedOffers } from "../email-intake/received-offers";
import { createFollowUps } from "../follow-ups";
import { createHumanCoaches, type HumanCoaches } from "../human-coaches";
import { createJobDigests, type JobDigests } from "../job-digests";
import { createJobOffers, type JobOffers } from "../job-offers";
import { createJobSearches, type JobSearches } from "../job-searches";
import { migrateDatabase } from "../migrations";
import { createProfiles, type Profiles } from "../profiles";
import { createTailoredCvs, type TailoredCvs } from "../tailored-cv";
import { createTailoredDocuments, type TailoredDocuments } from "../tailored-documents";
import { createWithdrawals } from "../withdrawals";
import { createCandidateReads, type CandidateReads } from "./index";

/** The estimate of the AI Coach's context by category, as the reply in the tests says it (#731). */
const CONTEXT_SPLIT = { messages: 40, instructions: 2_000, profile: 900, advice: 300, sources: 60 };

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

/** What the fake AI Coach writes: a Tailored CV when asked for one, a Cover Letter otherwise. */
function writer(input: { system?: string; messages: { content: unknown }[] }): string {
  const asked = `${input.system ?? ""}\n${input.messages.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content))).join("\n")}`;
  if (/"missing"/.test(asked)) {
    return "```json\n" + JSON.stringify({ headline: "DAF groupe industriel", summary: "", experience: [], education: [], skills: ["IFRS", "SAP"], languages: [], missing: [] }) + "\n```";
  }
  return "Madame, Monsieur,\n\nVotre offre a retenu toute mon attention.";
}

/** Today, in the tests: a Wednesday in French winter time. */
const NOW = new Date("2026-11-04T09:00:00.000Z");

/** The CGV version in effect in the tests, as the Order page names it. */
const CGV = { text: "cgv", version: "2026-10-01", url: "/legal/cgv/2026-10-01", sha256: "a".repeat(64), change: "substantielle" } as const;

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
  let coaches: HumanCoaches;
  let atsScoring: AtsScoring;
  let tailoredCvs: TailoredCvs;
  let tailoredDocuments: TailoredDocuments;
  let conversations: CoachConversations;
  let reads: CandidateReads;
  let marie: string;
  let paul: string;
  let offers: number;
  /** The clock the Withdrawals read: a Coaching Session is withdrawable within its Withdrawal period. */
  let withdrawalsNow: Date;

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

  /** A Human Coach and a Coaching Session the Candidate paid them for, not dated yet. */
  async function paidSession(owner: string, name = "Sophie Martin") {
    const first = name.split(" ")[0]!.toLowerCase();
    const added = await coaches.add({ name, email: `${first}@rh-conseil.fr`, bookingUrl: `https://cal.com/${first}/seance`, bio: "Coach carrière, 15 ans de RH." });
    if (!added.ok) throw new Error("fixture Human Coach refused");
    await coaches.recordPaidSession({ checkoutSessionId: `cs_${first}_${owner}`, candidateId: owner, coachId: added.coach.id, amount: 9000, currency: "eur" });
    const session = (await coaches.sessions(owner)).find((paid) => paid.coach.id === added.coach.id)!;
    return { coach: added.coach, sessionId: session.id };
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
    coaches = createHumanCoaches(database, { profiles, applications, tailoredDocuments: { get: async () => null }, tailoredCvs: { get: async () => null }, now: () => NOW });
    atsScoring = createAtsScoring({ database, profiles, actionCards, now: () => NOW });
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral", reply: writer })], routes: { writing: "mistral" }, usage: createMemoryUsageLog() });
    tailoredCvs = createTailoredCvs(database, { applications, profiles, ai });
    tailoredDocuments = createTailoredDocuments(database, { applications, profiles, ai });
    // The AI Coach's reply, by rules in the tests: what is saved with it is what the app reads.
    const coach = {
      reply: async () => ({ ok: true as const, reply: "Voici mes conseils.", outcome: "replied" as const, cost: null, playbooks: [], consultations: [], provenance: rulesProvenance("ats_score", { at: NOW }), contextTokens: 3_300, contextSplit: CONTEXT_SPLIT }),
    };
    conversations = createCoachConversations(database, { coach, profiles, now: () => NOW });
    // An hour after now: a Coaching Session is paid at the database's time.
    withdrawalsNow = new Date(Date.now() + 60 * 60 * 1000);
    const withdrawals = createWithdrawals(database, {
      billing,
      humanCoaches: coaches,
      orders: { immediateExecutionRequested: async () => false },
      mailer: { send: async () => {} },
      baseURL: BASE_URL,
      now: () => withdrawalsNow,
    });
    // The Order page's terms (orders.test.ts), for any Human Coach of the Candidate's: Stripe is not configured here.
    const orders = {
      terms: async (_candidateId: string, item: { kind: string; coachId?: string }) => {
        const coach = (await coaches.list()).find((each) => each.id === item.coachId);
        return coach ? { summary: { kind: "coachingSession" as const, subject: { fr: coach.name, en: coach.name }, price: { amount: 9000, currency: "eur", interval: null } }, cgv: CGV } : null;
      },
    };
    reads = createCandidateReads({
      applications,
      followUps,
      profiles,
      jobSearches,
      jobDigests,
      agenda: createAgenda(database),
      humanCoaches: coaches,
      billing,
      withdrawals,
      orders,
      atsScoring,
      tailoredCvs,
      tailoredDocuments,
      coachConversations: conversations,
      now: () => NOW,
    });
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

  describe("Agenda", () => {
    it("gives « À planifier » first, then the Agenda Items by day in French time", async () => {
      const profileId = await createProfile(marie);
      const applicationId = await saveApplication(marie, profileId);
      await applications.addInterview(marie, applicationId, { scheduledAt: "2026-11-12T14:30", place: "Lyon", moveToInterview: true });
      const toSchedule = await paidSession(marie, "Sophie Martin");
      const dated = await paidSession(marie, "Jean Leroy");
      await coaches.scheduleSession(marie, dated.sessionId, { scheduledAt: "2026-11-12T09:00", durationMinutes: 45, videoLink: "https://meet.example.com/xyz" });

      const agenda = overHttp(agendaResponseSchema, await reads.agenda(marie));

      expect(agenda.toSchedule).toEqual([{ id: toSchedule.sessionId, coach: { id: toSchedule.coach.id, name: "Sophie Martin", bookingUrl: "https://cal.com/sophie/seance" }, paidAt: expect.any(String), reschedules: [] }]);
      expect(agenda.days).toEqual([
        {
          day: "2026-11-12",
          items: [
            expect.objectContaining({ kind: "coachingSession", id: dated.sessionId, coach: { id: dated.coach.id, name: "Jean Leroy" }, scheduledAt: "2026-11-12T08:00:00.000Z", durationMinutes: 45, changedBy: "candidate" }),
            expect.objectContaining({ kind: "interview", applicationId, jobTitle: "DAF H/F", employer: "Acme Industrie", scheduledAt: "2026-11-12T13:30:00.000Z", place: "Lyon", cancelledAt: null }),
          ],
        },
      ]);
    });

    it("gives the past Agenda Items when asked for, newest first", async () => {
      const applicationId = await saveApplication(marie, await createProfile(marie));
      await applications.addInterview(marie, applicationId, { scheduledAt: "2026-10-20T10:00", moveToInterview: true });
      await applications.addInterview(marie, applicationId, { scheduledAt: "2026-11-12T10:00" });

      const past = overHttp(agendaResponseSchema, await reads.agenda(marie, { past: true }));

      expect(past.days.map((day) => day.day)).toEqual(["2026-10-20"]);
    });

    it("never gives a Candidate another Candidate's Agenda Items", async () => {
      const applicationId = await saveApplication(marie, await createProfile(marie));
      await applications.addInterview(marie, applicationId, { scheduledAt: "2026-11-12T14:30", moveToInterview: true });
      await paidSession(marie);

      expect(overHttp(agendaResponseSchema, await reads.agenda(paul))).toEqual({ toSchedule: [], days: [] });
    });
  });

  describe("Mes coachs humains", () => {
    it("gives the Human Coaches with the Coach Access granted, and the Coaching Sessions, never a Human Coach's email", async () => {
      const { coach, sessionId } = await paidSession(marie);
      await coaches.grantAccess(marie, coach.id);

      const answer = await reads.coaching(marie);
      const coaching = overHttp(coachingResponseSchema, answer);

      expect(coaching.coaches).toEqual([{ id: coach.id, name: "Sophie Martin", bio: "Coach carrière, 15 ans de RH.", accessGranted: true }]);
      expect(coaching.sessions).toEqual([
        {
          id: sessionId,
          coach: { id: coach.id, name: "Sophie Martin", bookingUrl: "https://cal.com/sophie/seance" },
          paidAt: expect.any(String),
          scheduledAt: null,
          durationMinutes: null,
          videoLink: null,
          note: null,
          changedBy: null,
          reschedules: [],
          withdrawable: true,
        },
      ]);
      // No Stripe price in the tests: the price cannot be read, as the page says.
      expect(coaching.price).toBeNull();
      expect(JSON.stringify(answer)).not.toContain("sophie@rh-conseil.fr");
    });

    it("says which Coaching Sessions can still be withdrawn from, as the Agenda does (#694)", async () => {
      await paidSession(marie);

      withdrawalsNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const coaching = overHttp(coachingResponseSchema, await reads.coaching(marie));

      expect(coaching.sessions).toEqual([expect.objectContaining({ withdrawable: false })]);
    });

    it("gives the Order page of a Coaching Session the app shows before Checkout: the Human Coach, the price, the CGV version (#694)", async () => {
      const { coach } = await paidSession(marie);

      const order = overHttp(coachingOrderResponseSchema, await reads.coachingOrder(marie, coach.id));

      expect(order).toEqual({ coach: { id: coach.id, name: "Sophie Martin" }, price: { amount: 9000, currency: "eur" }, cgv: { version: "2026-10-01", url: "/legal/cgv/2026-10-01" } });
      expect(await reads.coachingOrder(marie, "8d0c6c4e-0000-4a51-9c39-0b7b2f1c9a10")).toBeNull();
    });

    it("never gives a Candidate another Candidate's Coaching Sessions", async () => {
      await paidSession(marie);

      const coaching = overHttp(coachingResponseSchema, await reads.coaching(paul));

      expect(coaching.sessions).toEqual([]);
      expect(coaching.coaches).toEqual([expect.objectContaining({ name: "Sophie Martin", accessGranted: false })]);
    });
  });

  describe("Profiles", () => {
    it("lists the active Profiles, an Archived Profile left out", async () => {
      const daf = await createProfile(marie);
      await profiles.archive(marie, await createProfile(marie, "Contrôleur de gestion"));

      expect(overHttp(profilesResponseSchema, await reads.profiles(marie))).toEqual([{ id: daf, name: "DAF" }]);
    });

    it("gives a Profile to read: its Search Criteria, its current Master CV and its ATS Score", async () => {
      const daf = await createProfile(marie);
      const scored = await atsScoring.analyse(marie, daf, "fr");
      if (!scored.ok) throw new Error("fixture ATS Score refused");

      const profile = overHttp(profileResponseSchema, await reads.profile(marie, daf));

      expect(profile).toMatchObject({
        id: daf,
        name: "DAF",
        archived: false,
        searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] },
        masterCv: { version: 1, content: { headline: "Directrice financière", skills: ["IFRS", "SAP"] } },
        atsScore: scored.atsScore.score.score,
      });
    });

    it("says an Archived Profile is archived, and has no ATS Score before the first", async () => {
      const archived = await createProfile(marie, "Contrôleur de gestion");
      await profiles.archive(marie, archived);

      expect(overHttp(profileResponseSchema, await reads.profile(marie, archived))).toMatchObject({ archived: true, atsScore: null });
    });

    it("never gives a Candidate another Candidate's Profile", async () => {
      const daf = await createProfile(marie);

      expect(await reads.profile(paul, daf)).toBeNull();
      expect(await reads.profiles(paul)).toEqual([]);
    });
  });

  describe("Tailored Documents", () => {
    it("gives an Application's Tailored Documents with their download links, the Outreach Message without a file but with its words", async () => {
      const id = await saveApplication(marie, await createProfile(marie));
      const proposed = await tailoredCvs.propose(marie, id, {});
      if (!proposed.ok) throw new Error(`fixture Tailored CV refused: ${JSON.stringify(proposed)}`);
      const { revision, changes } = proposed.tailoredCv.proposal!;
      await tailoredCvs.save(marie, id, { revision, accepted: changes.map((change) => change.id) });
      await tailoredDocuments.draft(marie, id, { document: "cover_letter" });
      await tailoredDocuments.draft(marie, id, { document: "outreach_message" });

      const documents = overHttp(tailoredDocumentsResponseSchema, await reads.tailoredDocuments(marie, id));
      const outreachMessage = (await tailoredDocuments.get(marie, id))!.outreachMessage!;

      expect(documents.documentLanguage).toBe("fr");
      expect(documents.documents).toEqual([
        {
          kind: "tailored_cv",
          language: "fr",
          updatedAt: expect.any(String),
          downloads: { pdf: `/api/applications/${id}/tailored-cv/export?format=pdf&template=classic`, docx: `/api/applications/${id}/tailored-cv/export?format=docx&template=classic` },
          message: null,
        },
        {
          kind: "cover_letter",
          language: "fr",
          updatedAt: expect.any(String),
          downloads: { pdf: `/api/applications/${id}/cover-letter/export?format=pdf&template=classic`, docx: `/api/applications/${id}/cover-letter/export?format=docx&template=classic` },
          message: null,
        },
        { kind: "outreach_message", language: "fr", updatedAt: expect.any(String), downloads: null, message: { subject: outreachMessage.subject, text: outreachMessage.text } },
      ]);
    });

    it("gives none before the AI Coach wrote one, a Tailored CV still under review included", async () => {
      const id = await saveApplication(marie, await createProfile(marie));
      await tailoredCvs.propose(marie, id, {});

      expect(overHttp(tailoredDocumentsResponseSchema, await reads.tailoredDocuments(marie, id)).documents).toEqual([]);
    });

    it("never gives a Candidate another Candidate's Tailored Documents", async () => {
      const id = await saveApplication(marie, await createProfile(marie));
      await tailoredDocuments.draft(marie, id, { document: "cover_letter" });

      expect(await reads.tailoredDocuments(paul, id)).toBeNull();
    });
  });

  describe("Coach Conversations", () => {
    async function send(owner: string, input: object) {
      const sent = await conversations.send(owner, input);
      if (!sent.ok) throw new Error(`fixture message refused: ${JSON.stringify(sent)}`);
      return sent.conversation.id;
    }

    it("lists the Free conversations alone when asked for, the drawer's list", async () => {
      const free = await send(marie, { message: "Comment négocier mon salaire ?" });
      await send(marie, { subject: { kind: "menu", id: "agenda" }, message: "Mon agenda ?" });

      const all = overHttp(coachConversationsResponseSchema, await reads.coachConversations(marie));
      const drawer = overHttp(coachConversationsResponseSchema, await reads.coachConversations(marie, { free: true }));

      expect(all.conversations).toHaveLength(2);
      expect(drawer.conversations).toEqual([{ id: free, title: expect.stringContaining("Comment négocier"), subject: null, profile: null, lastMessageAt: NOW.toISOString() }]);
    });

    it("gives a Subject's conversation with its messages, null until its first message", async () => {
      const subject = { kind: "menu", id: "applications" };
      expect(overHttp(coachConversationResponseSchema, await reads.coachConversationOfSubject(marie, subject))).toEqual({ conversation: null });

      const id = await send(marie, { subject, message: "Laquelle relancer ?" });
      const { conversation } = overHttp(coachConversationResponseSchema, await reads.coachConversationOfSubject(marie, subject));

      expect(conversation).toMatchObject({ id, subject: { kind: "menu", id: "applications" }, aiDisclosure: true, context: { messages: 2 } });
      expect(conversation?.messages).toEqual([
        { from: "candidate", text: "Laquelle relancer ?" },
        expect.objectContaining({ from: "coach", text: "Voici mes conseils.", at: NOW.toISOString(), provenance: expect.objectContaining({ v: 1 }) }),
      ]);
      expect(overHttp(coachConversationResponseSchema, await reads.coachConversation(marie, id)).conversation?.id).toBe(id);
    });

    it("gives a reopened conversation its Context bar as the reply said it: the Plan's Coach context limits, the split (#731) and no Plan to name below 80 % (#732)", async () => {
      const subject = { kind: "menu", id: "applications" };
      const id = await send(marie, { subject, message: "Laquelle relancer ?" });
      // A Plan with none stored: what every Candidate had before they were Plan limits (ADR-0078).
      const context = { messages: 2, tokens: 3_300, limits: { coachContextMessages: 40, coachContextTokens: 12_000 }, split: CONTEXT_SPLIT, upgrade: null };

      expect(overHttp(coachConversationResponseSchema, await reads.coachConversation(marie, id)).conversation?.context).toEqual(context);
      expect(overHttp(coachConversationResponseSchema, await reads.coachConversationOfSubject(marie, subject)).conversation?.context).toEqual(context);
    });

    it("refuses a Subject it does not know, and never gives a Candidate another Candidate's conversation", async () => {
      const id = await send(marie, { message: "Bonjour" });
      const application = await saveApplication(marie, await createProfile(marie));
      await send(marie, { subject: { kind: "application", id: application }, message: "Et celle-ci ?" });

      expect(await reads.coachConversationOfSubject(marie, { kind: "menu", id: "nowhere" })).toEqual({ error: "invalid" });
      expect(await reads.coachConversationOfSubject(paul, { kind: "application", id: application })).toEqual({ error: "not_found" });
      expect(await reads.coachConversation(paul, id)).toBeNull();
      expect(overHttp(coachConversationsResponseSchema, await reads.coachConversations(paul)).conversations).toEqual([]);
    });
  });
});
