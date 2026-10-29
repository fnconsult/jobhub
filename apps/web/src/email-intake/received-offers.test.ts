import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { migrateEmailIntake } from "./index";
import { migrateEmailReadings } from "./reading";
import { createReceivedOffers, type ReceivedOffers } from "./received-offers";
import { seedReceivedOfferEmail } from "./test-support";

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

const HOUR = 3_600_000;

describe.skipIf(!connectionString)("Email intake: what it gave the Candidate, for Recherches d'offres (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let received: ReceivedOffers;
  let clock: { now: Date };
  let threshold: number;
  let marie: string;
  let paul: string;
  let daf: string;
  let consultant: string;
  let captured: number;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  async function createProfile(owner: string, targetRole: string) {
    const created = await profiles.create(owner, { masterCv, searchCriteria: { targetRole, locations: ["Lyon"], contractTypes: ["cdi"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    return created.profile.id;
  }

  /** A Job Offer that fits Marie's Profiles (Match Score 100), shared unless `privateTo`. */
  async function offer(title: string, privateTo?: string) {
    captured++;
    const result = await jobOffers.capture(
      {
        source: { url: `https://carrieres.example.fr/${encodeURIComponent(title)}/${captured}` },
        title,
        content: `${title} (${captured}). Poste à pourvoir.`,
        employer: "Acme Industrie",
        location: "Lyon",
        contractType: "cdi",
        skills: ["IFRS", "SAP"],
      },
      "candidate",
      privateTo ? { privateTo } : {},
    );
    if (!result.ok) throw new Error("fixture Job Offer refused");
    return result.jobOffer.id;
  }

  const hoursAgo = (hours: number) => new Date(clock.now.getTime() - hours * HOUR);

  /** An alert read `hoursAgo` hours ago that gave Marie these Job Offers for `profile` (null: « Non classées »). */
  const alert = (owner: string, hours: number, profile: string | null, ...jobOfferIds: string[]) =>
    seedReceivedOfferEmail(database, {
      candidateId: owner,
      senderDomain: "linkedin.com",
      receivedAt: hoursAgo(hours),
      offers: jobOfferIds.map((jobOfferId) => ({ disposition: "new" as const, jobOfferId, profileId: profile, matchScore: profile ? 100 : 45 })),
    });

  const overviewOf = (owner: string) => received.overview(owner, { broadFilterThreshold: threshold });

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateEmailIntake(database);
    await migrateEmailReadings(database);
    // A Thursday afternoon, in French winter time: the week began on Monday 2026-11-02 at 00:00, Paris time.
    clock = { now: new Date("2026-11-05T15:00:00+01:00") };
    threshold = 20;
    captured = 0;
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    received = createReceivedOffers(database, { jobOffers, profiles, applications, now: () => clock.now });
    marie = await candidate("marie.dupont@example.fr");
    paul = await candidate("paul.martin@example.fr");
    daf = await createProfile(marie, "DAF");
    consultant = await createProfile(marie, "Consultant transformation");
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("gives each Profile the Job Offers its emails brought, newest first, with their Match Score and how many arrived this week (« nouvelles »)", async () => {
    const lastWeek = await offer("DAF – la semaine dernière");
    const monday = await offer("DAF – lundi");
    const today = await offer("DAF – ce matin");
    const forConsultant = await offer("Consultant – mardi");
    await alert(marie, 4 * 24, daf, lastWeek); // Sunday: last week
    await alert(marie, 3 * 24, daf, monday);
    await alert(marie, 2 * 24, consultant, forConsultant);
    await alert(marie, 5, daf, today);

    const overview = await overviewOf(marie);

    expect(overview.byProfile[daf]?.offers.map(({ jobOffer, matchScore }) => [jobOffer.id, matchScore.score])).toEqual([
      [today, 100],
      [monday, 100],
      [lastWeek, 100],
    ]);
    expect(overview.byProfile[daf]?.fresh).toBe(2);
    expect(overview.byProfile[consultant]).toMatchObject({ offers: [{ jobOffer: { id: forConsultant } }], fresh: 1 });
    expect(overview.byProfile[daf]?.offers[0]).toMatchObject({ receivedAt: hoursAgo(5), senderDomain: "linkedin.com", applicationId: null });
  });
  it("puts the Job Offers no Profile scored 60 or more for in « Non classées », with their best Match Score when read", async () => {
    const unclassified = await offer("Chargé de mission – non classée");
    await alert(marie, 1, null, unclassified);

    const overview = await overviewOf(marie);

    expect(overview.unclassified).toMatchObject({ offers: [{ jobOffer: { id: unclassified }, matchScore: 45, senderDomain: "linkedin.com" }], fresh: 1 });
    expect(overview.byProfile).toEqual({});
  });

  it("shows no Job Offer private to another Candidate, nor another Candidate's emails, and leaves out offers « déjà vue », too old or « À capturer »", async () => {
    const theirs = await offer("Offre d'un recruteur à Paul", paul);
    const mine = await offer("Offre d'un recruteur à Marie", marie);
    const seen = await offer("Déjà vue");
    await alert(paul, 1, null, theirs);
    // A row naming another's private Job Offer for Marie is never trusted to show it.
    await alert(marie, 2, daf, theirs, mine);
    await seedReceivedOfferEmail(database, {
      candidateId: marie,
      receivedAt: hoursAgo(3),
      offers: [{ disposition: "seen", jobOfferId: seen }, { disposition: "too_old" }, { disposition: "to_capture", title: "DAF", link: "https://www.linkedin.com/jobs/view/1" }],
    });

    const overview = await overviewOf(marie);

    expect(overview.byProfile[daf]?.offers.map((received) => received.jobOffer.id)).toEqual([mine]);
    expect(overview.unclassified.offers).toEqual([]);
    expect((await overviewOf(paul)).unclassified.offers.map((received) => received.jobOffer.id)).toEqual([theirs]);
  });

  it("names the Candidate's Application for a Job Offer they saved", async () => {
    const saved = await offer("DAF – enregistrée");
    await alert(marie, 1, daf, saved);
    const application = await applications.save(marie, { jobOfferId: saved, profileId: daf });
    if (!application.ok) throw new Error("fixture Application refused");

    expect((await overviewOf(marie)).byProfile[daf]?.offers[0]?.applicationId).toBe(application.application.id);
  });

  it("lists the emails ignored this week, newest first, with their reason, sender's domain and date, never another's", async () => {
    const ignored = (owner: string, hours: number, outcome: "other" | "unrecognised_sender" | "guardrail" | "failed" | "over_daily_cap" | "forwarding_confirmation", senderDomain: string) =>
      seedReceivedOfferEmail(database, { candidateId: owner, outcome, senderDomain, receivedAt: hoursAgo(hours) });
    await ignored(marie, 4 * 24, "other", "lastweek.example"); // Sunday: last week
    await ignored(marie, 3 * 24, "other", "jobijoba.com");
    await ignored(marie, 30, "unrecognised_sender", "inconnu.example");
    await ignored(marie, 20, "guardrail", "piege.example");
    await ignored(marie, 2, "failed", "cadremploi.fr");
    await ignored(marie, 1, "forwarding_confirmation", "google.com");
    await ignored(paul, 1, "other", "paul.example");
    await alert(marie, 1, daf, await offer("DAF"));

    expect((await overviewOf(marie)).ignored).toEqual([
      { reason: "failed", senderDomain: "cadremploi.fr", receivedAt: hoursAgo(2) },
      { reason: "guardrail", senderDomain: "piege.example", receivedAt: hoursAgo(20) },
      { reason: "unrecognised_sender", senderDomain: "inconnu.example", receivedAt: hoursAgo(30) },
      { reason: "other", senderDomain: "jobijoba.com", receivedAt: hoursAgo(3 * 24) },
    ]);
  });

  it("says the filter is too broad from the threshold of emails a day this week, Gmail's confirmation aside", async () => {
    const emails = async (count: number, hours: number) => {
      for (let n = 0; n < count; n++) await seedReceivedOfferEmail(database, { candidateId: marie, outcome: n % 2 ? "other" : "over_daily_cap", receivedAt: hoursAgo(hours) });
    };
    threshold = 3;
    await emails(5, 4 * 24); // Sunday: last week
    await emails(2, 2 * 24);
    await seedReceivedOfferEmail(database, { candidateId: marie, outcome: "forwarding_confirmation", senderDomain: "google.com", receivedAt: hoursAgo(2 * 24) });
    expect((await overviewOf(marie)).tooBroad).toBeNull();

    await emails(3, 3 * 24); // Monday
    expect((await overviewOf(marie)).tooBroad).toEqual({ day: "2026-11-02", count: 3 });
    await emails(4, 1); // Thursday
    expect((await overviewOf(marie)).tooBroad).toEqual({ day: "2026-11-05", count: 4 });
    expect((await overviewOf(paul)).tooBroad).toBeNull();
  });
});
