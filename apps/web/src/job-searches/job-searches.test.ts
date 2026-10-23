import type { MasterCvContent, Provenance, ProvenanceEvent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createBilling, migrateBilling, STARTING_PLAN_QUOTAS, type Billing } from "../billing";
import { createJobOffers, createSourceChecks, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createJobSearchReports, createJobSearches, JOB_DISCOVERY_QUEUE, migrateJobSearches, type JobSearches } from "./index";

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

describe.skipIf(!connectionString)("Job Searches (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let billing: Billing;
  let jobSearches: JobSearches;
  let sent: { name: string; data: object }[];
  let clock: { now: Date };
  let candidateId: string;
  let otherCandidateId: string;
  let profileId: string;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function createProfile(owner: string) {
    const created = await profiles.create(owner, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"], remoteWorkOptions: [] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    return created.profile.id;
  }

  async function capture(title: string, details: object, postedAt?: Date) {
    const captured = await jobOffers.capture(
      { source: { url: `https://carrieres.example.fr/${encodeURIComponent(title)}` }, title, content: `${title}. Poste à pourvoir.`, ...details },
      "candidate",
      postedAt ? { postedAt } : {},
    );
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    return captured.jobOffer.id;
  }

  async function started(owner = candidateId, profile = profileId) {
    const result = await jobSearches.start(owner, { profileId: profile });
    if (!result.ok) throw new Error(`fixture Job Search refused: ${JSON.stringify(result)}`);
    return result.jobSearch;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    const database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateBilling(database);
    await migrateJobSearches(database);
    clock = { now: new Date("2026-10-15T10:00:00+02:00") };
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    billing = createBilling({ database, baseURL: "http://localhost:3000", now: () => clock.now });
    // Three Job Searches a week on Free (it starts with one), so a test can search more than once.
    await billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, jobSearches: 3 });
    sent = [];
    jobSearches = createJobSearches(database, {
      profiles,
      jobOffers,
      applications,
      quotas: billing,
      queue: { send: async (name, data) => void sent.push({ name, data }) },
      now: () => clock.now,
    });
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
    profileId = await createProfile(candidateId);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("starting a Job Search for one of the Candidate's Profiles asks for Job discovery on that Profile", async () => {
    const result = await jobSearches.start(candidateId, { profileId });

    expect(result).toMatchObject({ ok: true, jobSearch: { status: "searching", profile: { id: profileId, name: "DAF" }, results: [] } });
    const jobSearchId = result.ok ? result.jobSearch.id : "";
    expect(sent).toEqual([{ name: JOB_DISCOVERY_QUEUE, data: { candidateId, profileId, jobSearchId } }]);
    expect(await jobSearches.get(candidateId, jobSearchId)).toMatchObject({ id: jobSearchId, status: "searching" });
  });

  it("shows the Job Offers found, best Match Score first, each with the Application the Candidate already has", async () => {
    const weak = await capture("Contrôleur de gestion", { location: "Marseille", contractType: "cdd", skills: ["Excel"] });
    const strong = await capture("DAF H/F", { employer: "Acme Industrie", location: "Lyon", contractType: "cdi", skills: ["IFRS", "SAP"] });
    const jobSearch = await started();
    const saved = await applications.save(candidateId, { jobOfferId: strong, profileId });
    if (!saved.ok) throw new Error("fixture Application refused");

    await jobSearches.record(jobSearch.id, { jobOfferIds: [weak, strong] });

    const done = await jobSearches.get(candidateId, jobSearch.id);
    expect(done?.status).toBe("done");
    expect(done?.results.map((result) => [result.jobOffer.title, result.applicationId])).toEqual([
      ["DAF H/F", saved.application.id],
      ["Contrôleur de gestion", null],
    ]);
    expect(done?.results[0]).toMatchObject({ jobOffer: { employer: "Acme Industrie", location: "Lyon", contractType: "cdi" }, matchScore: { score: 100 } });
    expect(done!.results[0]!.matchScore.score).toBeGreaterThan(done!.results[1]!.matchScore.score);
  });

  it("names the Search Criteria its Match Scores are against: the Profile's current ones", async () => {
    const jobSearch = await started();
    const changed = await profiles.changeSearchCriteria(candidateId, profileId, {
      searchCriteria: { targetRole: "DAF", locations: ["Villeurbanne"], contractTypes: ["cdi"], remoteWorkOptions: [], minSalary: 85000 },
    });
    expect(changed.ok).toBe(true);

    expect((await jobSearches.get(candidateId, jobSearch.id))?.profile).toEqual({
      id: profileId,
      name: "DAF",
      searchCriteria: { targetRole: "DAF", locations: ["Villeurbanne"], contractTypes: ["cdi"], remoteWorkOptions: [], minSalary: 85000, sectors: [], subsectors: [], domains: [] },
    });
  });

  it("ranks an undated Job Offer below a dated one with an equal Match Score, never above a lower one (#116)", async () => {
    const lyon = { location: "Lyon", contractType: "cdi", skills: ["IFRS", "SAP"] };
    const undated = await capture("DAF H/F – A", lyon);
    const dated = await capture("DAF H/F – B", lyon, new Date("2026-10-01T00:00:00Z"));
    const weakDated = await capture("Contrôleur de gestion", { location: "Marseille", contractType: "cdd" }, new Date("2026-10-10T00:00:00Z"));
    const jobSearch = await started();

    await jobSearches.record(jobSearch.id, { jobOfferIds: [weakDated, undated, dated] });

    const results = (await jobSearches.get(candidateId, jobSearch.id))!.results;
    expect(results.map((result) => [result.jobOffer.id, result.jobOffer.postedAt])).toEqual([
      [dated, new Date("2026-10-01T00:00:00Z")],
      [undated, undefined],
      [weakDated, new Date("2026-10-10T00:00:00Z")],
    ]);
    expect(results[0]!.matchScore.score).toBe(results[1]!.matchScore.score);
    expect(results[1]!.matchScore.score).toBeGreaterThan(results[2]!.matchScore.score);
  });

  it("leaves Expired Job Offers out of the results", async () => {
    const expired = await capture("DAF H/F", { location: "Lyon", contractType: "cdi" });
    const published = await capture("Contrôleur de gestion", { location: "Lyon" });
    const jobSearch = await started();
    await jobSearches.record(jobSearch.id, { jobOfferIds: [expired, published] });
    expect((await jobSearches.get(candidateId, jobSearch.id))?.results).toHaveLength(2);

    // Two gone checks in a row at its source make it an Expired Job Offer.
    const sourceChecks = createSourceChecks(testAuth.auth.options.database as Pool);
    await sourceChecks.record(expired, "gone", new Date(Date.now() + 3 * 86_400_000));
    await sourceChecks.record(expired, "gone", new Date(Date.now() + 6 * 86_400_000));

    expect((await jobSearches.get(candidateId, jobSearch.id))?.results.map((result) => result.jobOffer.id)).toEqual([published]);
  });

  it("gives the Profile's latest done Job Search, with its results, to the Candidate only", async () => {
    expect(await jobSearches.latest(candidateId, profileId)).toBeNull();
    const older = await started();
    await jobSearches.record(older.id, { jobOfferIds: [await capture("Contrôleur de gestion", { location: "Lyon" })] });
    clock.now = new Date("2026-10-16T10:00:00+02:00");
    const newer = await started();
    await jobSearches.record(newer.id, { jobOfferIds: [await capture("DAF H/F", { location: "Lyon", contractType: "cdi" })] });
    clock.now = new Date("2026-10-17T10:00:00+02:00");
    await started(); // still searching: not done yet

    const latest = await jobSearches.latest(candidateId, profileId);

    expect(latest).toMatchObject({ id: newer.id, status: "done" });
    expect(latest?.results.map((result) => result.jobOffer.title)).toEqual(["DAF H/F"]);
    expect(await jobSearches.latest(otherCandidateId, profileId)).toBeNull();
    expect(await jobSearches.latest(candidateId, "not-a-uuid")).toBeNull();
  });

  it("gives the Profile's Job Search still searching, to the Candidate only, until it is done or past its time", async () => {
    expect(await jobSearches.searching(candidateId, profileId)).toBeNull();
    const first = await started();
    expect(await jobSearches.searching(candidateId, profileId)).toMatchObject({ id: first.id, status: "searching" });
    expect(await jobSearches.searching(otherCandidateId, profileId)).toBeNull();
    expect(await jobSearches.searching(candidateId, "not-a-uuid")).toBeNull();

    await jobSearches.record(first.id, { jobOfferIds: [] });
    expect(await jobSearches.searching(candidateId, profileId)).toBeNull();

    const forgotten = await started();
    clock.now = new Date(clock.now.getTime() + 16 * 60 * 1000);
    expect(await jobSearches.searching(candidateId, profileId)).toBeNull();
    expect(await jobSearches.get(candidateId, forgotten.id)).toMatchObject({ status: "failed", failure: "timeout" });
  });

  it("only searches for the Candidate's own, active Profiles", async () => {
    const othersProfile = await createProfile(otherCandidateId);
    expect(await jobSearches.start(candidateId, { profileId: othersProfile })).toEqual({ ok: false, error: "not_found" });
    expect(await jobSearches.start(candidateId, {})).toMatchObject({ ok: false, errors: [{ field: "profileId" }] });

    await profiles.archive(candidateId, profileId);
    expect(await jobSearches.start(candidateId, { profileId })).toEqual({ ok: false, error: "archived" });
    expect(sent).toEqual([]);
  });

  it("keeps each Candidate's Job Searches to themselves", async () => {
    const jobSearch = await started();

    expect(await jobSearches.get(otherCandidateId, jobSearch.id)).toBeNull();
    expect(await jobSearches.get(candidateId, "not-a-job-search")).toBeNull();
  });

  it("lets a Free Candidate start 3 Job Searches a week (as their Plan grants), then shows what Plan lets them go on, without searching", async () => {
    for (let i = 0; i < 3; i++) await started();

    expect(await jobSearches.start(candidateId, { profileId })).toEqual({
      ok: false,
      error: "quota_exceeded",
      refusal: { allowed: false, quota: "jobSearches", plan: "free", planName: { fr: "Gratuite", en: "Free" }, limit: 3, upgradeTo: "standard", upgradeToName: { fr: "Standard", en: "Standard" } },
    });
    expect(sent).toHaveLength(3);

    await billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, jobSearches: 4 });
    expect((await jobSearches.start(candidateId, { profileId })).ok).toBe(true);
  });

  it("shows a Job Search as failed when Job discovery could not run, or never answered", async () => {
    const failed = await started();
    await jobSearches.record(failed.id, { failed: "unavailable" });
    expect(await jobSearches.get(candidateId, failed.id)).toMatchObject({ status: "failed", failure: "unavailable", results: [] });

    const forgotten = await started();
    clock.now = new Date(clock.now.getTime() + 14 * 60 * 1000);
    expect((await jobSearches.get(candidateId, forgotten.id))?.status).toBe("searching");
    clock.now = new Date(clock.now.getTime() + 2 * 60 * 1000);
    expect(await jobSearches.get(candidateId, forgotten.id)).toMatchObject({ status: "failed", failure: "timeout" });
  });

  it("does not change a finished Job Search when Job discovery reports again", async () => {
    const jobOfferId = await capture("DAF H/F", { location: "Lyon" });
    const jobSearch = await started();
    await jobSearches.record(jobSearch.id, { jobOfferIds: [jobOfferId] });

    await jobSearches.record(jobSearch.id, { failed: "unavailable" });

    expect(await jobSearches.get(candidateId, jobSearch.id)).toMatchObject({ status: "done", results: [{ jobOffer: { id: jobOfferId } }] });
  });

  it("shows the Job Search as failed when Job discovery cannot be queued", async () => {
    const searches = createJobSearches(testAuth.auth.options.database as Pool, {
      profiles,
      jobOffers,
      applications,
      quotas: billing,
      queue: { send: async () => Promise.reject(new Error("connection refused")) },
    });

    const result = await searches.start(candidateId, { profileId });

    expect(result).toMatchObject({ ok: true, jobSearch: { status: "failed" } });
  });
  describe("what a Job Search measured", () => {
    const measured = {
      funnel: { providerUrls: 10, fetched: 4, extracted: 2, alreadyStored: 1, afterDedup: 2, matched: 1 },
      skipped: { robots: 1, site_terms: 2, bot_protection: 3, login_wall: 0, not_public: 0, gone: 1, unreachable: 0, not_a_job_offer: 2, invalid: 0, too_old: 0, site_disabled: 0 },
      costEur: 0.0142,
    };
    const nothing = {
      funnel: { providerUrls: 0, fetched: 0, extracted: 0, alreadyStored: 0, afterDedup: 0, matched: 0 },
      skipped: { robots: 0, site_terms: 0, bot_protection: 0, login_wall: 0, not_public: 0, gone: 0, unreachable: 0, not_a_job_offer: 0, invalid: 0, too_old: 0, site_disabled: 0 },
      costEur: 0,
    };
    const later = (ms: number) => (clock.now = new Date(clock.now.getTime() + ms));

    it("is unknown while it is searching", async () => {
      const jobSearch = await started();

      expect((await jobSearches.get(candidateId, jobSearch.id))?.metrics).toBeNull();
    });

    it("keeps with a finished Job Search its funnel, pages skipped by reason, cost, and how long the Candidate waited", async () => {
      const jobOfferId = await capture("DAF H/F", { location: "Lyon" });
      const jobSearch = await started();
      later(42_500);

      await jobSearches.record(jobSearch.id, { jobOfferIds: [jobOfferId], metrics: measured });

      expect((await jobSearches.get(candidateId, jobSearch.id))?.metrics).toEqual({ ...measured, durationMs: 42_500 });
    });

    it("keeps with a failed Job Search what Job discovery measured before failing", async () => {
      const jobSearch = await started();
      later(8_000);

      await jobSearches.record(jobSearch.id, { failed: "discovery_failed", metrics: measured });

      expect((await jobSearches.get(candidateId, jobSearch.id))?.metrics).toEqual({ ...measured, durationMs: 8_000 });
    });

    it("counts nothing for a Job Search that failed before Job discovery ran, never answered, or could not be queued", async () => {
      const unavailable = await started();
      later(1_000);
      await jobSearches.record(unavailable.id, { failed: "unavailable" });
      expect((await jobSearches.get(candidateId, unavailable.id))?.metrics).toEqual({ ...nothing, durationMs: 1_000 });

      const expired = await started();
      later(20 * 60 * 1000);
      await createJobSearchReports(testAuth.auth.options.database as Pool, { quotas: billing, now: () => clock.now }).expireTimedOut();
      expect((await jobSearches.get(candidateId, expired.id))?.metrics).toEqual({ ...nothing, durationMs: 20 * 60 * 1000 });

      const forgotten = await started();
      later(16 * 60 * 1000);
      expect(await jobSearches.get(candidateId, forgotten.id)).toMatchObject({ status: "failed", metrics: { ...nothing, durationMs: 16 * 60 * 1000 } });

      const searches = createJobSearches(testAuth.auth.options.database as Pool, {
        profiles,
        jobOffers,
        applications,
        quotas: billing,
        queue: { send: async () => Promise.reject(new Error("connection refused")) },
        now: () => clock.now,
      });
      const unqueued = await searches.start(candidateId, { profileId });
      expect(unqueued.ok && (await jobSearches.get(candidateId, unqueued.jobSearch.id))?.metrics).toEqual({ ...nothing, durationMs: 0 });
    });
  });

  describe("the Plan Quota of Job Searches", () => {
    const used = async () => (await billing.entitlements(candidateId)).usedThisWeek.jobSearches;

    it("a successful Job Search uses one", async () => {
      const jobOfferId = await capture("DAF H/F", { location: "Lyon" });
      const jobSearch = await started();
      await jobSearches.record(jobSearch.id, { jobOfferIds: [jobOfferId] });

      expect(await used()).toBe(1);
    });

    it("a Job Search that cannot be queued leaves it unchanged", async () => {
      const searches = createJobSearches(testAuth.auth.options.database as Pool, {
        profiles,
        jobOffers,
        applications,
        quotas: billing,
        queue: { send: async () => Promise.reject(new Error("connection refused")) },
        now: () => clock.now,
      });
      await started();

      expect(await searches.start(candidateId, { profileId })).toMatchObject({ ok: true, jobSearch: { status: "failed" } });

      expect(await used()).toBe(1);
    });

    it("a Job Search the worker records as failed gives its use back, once", async () => {
      const reports = createJobSearchReports(testAuth.auth.options.database as Pool, { quotas: billing, now: () => clock.now });
      await started();
      const failed = await started();

      await reports.record(failed.id, { failed: "discovery_failed" });
      await reports.record(failed.id, { failed: "discovery_failed" });
      await jobSearches.record(failed.id, { failed: "unavailable" });

      expect(await used()).toBe(1);
    });

    it("a Job Search the worker never answered gives its use back once it is shown as failed", async () => {
      await started();
      const forgotten = await started();
      clock.now = new Date(clock.now.getTime() + 16 * 60 * 1000);

      expect((await jobSearches.get(candidateId, forgotten.id))?.status).toBe("failed");
      await jobSearches.get(candidateId, forgotten.id);

      expect(await used()).toBe(1);
    });

    it("Job Searches the worker never answered give their use back when expired, even unseen, once", async () => {
      const reports = createJobSearchReports(testAuth.auth.options.database as Pool, { quotas: billing, now: () => clock.now });
      const forgotten = await started();
      clock.now = new Date(clock.now.getTime() + 10 * 60 * 1000);
      const recent = await started();
      clock.now = new Date(clock.now.getTime() + 6 * 60 * 1000);

      expect(await reports.expireTimedOut()).toBe(1);
      expect(await reports.expireTimedOut()).toBe(0);
      await reports.record(forgotten.id, { failed: "discovery_failed" });

      expect(await used()).toBe(1);
      expect((await jobSearches.get(candidateId, forgotten.id))?.status).toBe("failed");
      expect((await jobSearches.get(candidateId, recent.id))?.status).toBe("searching");
    });

    it("a Job Search already done keeps its use when a failure is reported after", async () => {
      const jobSearch = await started();
      await jobSearches.record(jobSearch.id, { jobOfferIds: [] });

      await jobSearches.record(jobSearch.id, { failed: "unavailable" });

      expect(await used()).toBe(1);
    });
  });
  describe("Job Search notifications", () => {
    it("counts only the Job Offers the Job Search page shows: not Expired ones", async () => {
      const expired = await capture("DAF H/F", { location: "Lyon" });
      const published = await capture("Contrôleur de gestion", { location: "Lyon" });
      const jobSearch = await started();
      await jobSearches.record(jobSearch.id, { jobOfferIds: [expired, published] });
      const sourceChecks = createSourceChecks(testAuth.auth.options.database as Pool);
      await sourceChecks.record(expired, "gone", new Date(Date.now() + 3 * 86_400_000));
      await sourceChecks.record(expired, "gone", new Date(Date.now() + 6 * 86_400_000));

      expect((await jobSearches.notifications(candidateId)).notifications[0]?.outcome).toEqual({ status: "done", found: 1 });
    });

    it("stops telling the Candidate once they dismiss it, and only they can", async () => {
      const first = await started();
      await jobSearches.record(first.id, { jobOfferIds: [] });
      const second = await started();
      await jobSearches.record(second.id, { failed: "unavailable" });

      await jobSearches.dismissNotification(otherCandidateId, first.id);
      expect((await jobSearches.notifications(candidateId)).notifications).toHaveLength(2);
      expect(await jobSearches.notifications(otherCandidateId)).toEqual({ notifications: [], searching: false, running: [] });

      await jobSearches.dismissNotification(candidateId, first.id);
      await jobSearches.dismissNotification(candidateId, "not-a-uuid");
      expect((await jobSearches.notifications(candidateId)).notifications.map((notification) => notification.jobSearchId)).toEqual([second.id]);
    });

    it("still tells the Candidate when a Job Search finishes, even if dismissed while searching", async () => {
      const jobSearch = await started();
      await jobSearches.dismissNotification(candidateId, jobSearch.id);

      await jobSearches.record(jobSearch.id, { jobOfferIds: [] });

      expect((await jobSearches.notifications(candidateId)).notifications).toHaveLength(1);
    });

    it("tells the Candidate a Job Search failed, and why, including one the worker never answered", async () => {
      const failed = await started();
      await jobSearches.record(failed.id, { failed: "discovery_failed" });
      const forgotten = await started();
      clock.now = new Date(clock.now.getTime() + 16 * 60 * 1000);

      expect(await jobSearches.notifications(candidateId)).toEqual({
        notifications: [
          { jobSearchId: forgotten.id, profile: { id: profileId, name: "DAF" }, outcome: { status: "failed", failure: "timeout" } },
          { jobSearchId: failed.id, profile: { id: profileId, name: "DAF" }, outcome: { status: "failed", failure: "discovery_failed" } },
        ],
        searching: false,
        running: [],
      });
    });

    it("words an unknown failure as 'other'", async () => {
      const failed = await started();
      await jobSearches.record(failed.id, { failed: "something new" });

      expect((await jobSearches.notifications(candidateId)).notifications.map((notification) => notification.outcome)).toEqual([{ status: "failed", failure: "other" }]);
    });

    it("tells the Candidate a Job Search is done, with the number of Job Offers found", async () => {
      const daf = await capture("DAF H/F", { location: "Lyon" });
      const controleur = await capture("Contrôleur de gestion", { location: "Lyon" });
      const jobSearch = await started();
      expect(await jobSearches.notifications(candidateId)).toEqual({
        notifications: [],
        searching: true,
        running: [{ jobSearchId: jobSearch.id, profile: { id: profileId, name: "DAF" }, startedAt: jobSearch.startedAt.toISOString(), steps: [] }],
      });

      await jobSearches.record(jobSearch.id, { jobOfferIds: [daf, controleur] });

      expect(await jobSearches.notifications(candidateId)).toEqual({
        notifications: [{ jobSearchId: jobSearch.id, profile: { id: profileId, name: "DAF" }, outcome: { status: "done", found: 2 } }],
        searching: false,
        running: [],
      });
    });
  });
  describe("stopping a Job Search (#331)", () => {
    const used = async () => (await billing.entitlements(candidateId)).usedThisWeek.jobSearches;
    let reports: ReturnType<typeof createJobSearchReports>;
    beforeEach(() => {
      reports = createJobSearchReports(testAuth.auth.options.database as Pool, { quotas: billing, now: () => clock.now });
    });

    it("stopped mid-search, it is 'stopped', with the Job Offers found so far and the Provenance of the steps it finished", async () => {
      const daf = await capture("DAF H/F", { location: "Lyon" });
      const jobSearch = await started();
      const provenance: Provenance = {
        v: 1,
        steps: [
          { kind: "tool", activity: "search", tool: "france-travail", ms: 640, at: "2026-10-15T08:00:02.200Z", outcome: "ok", count: 1 },
          { kind: "ai", activity: "web_search", task: "web_search", ms: 300, at: "2026-10-15T08:00:03.000Z", outcome: "stopped", count: 1 },
        ],
        sites: [],
        startedAt: "2026-10-15T08:00:00.000Z",
        wallMs: 3400,
      };

      await reports.record(jobSearch.id, { stopped: true, jobOfferIds: [daf], provenance });

      expect(await jobSearches.get(candidateId, jobSearch.id)).toMatchObject({ status: "stopped", failure: null, results: [{ jobOffer: { id: daf } }], provenance });
      expect(await jobSearches.notifications(candidateId)).toMatchObject({ searching: false, running: [] });
    });

    it("stopped with no Job Offer kept, it gives its use back; with Job Offers kept, it counts", async () => {
      const daf = await capture("DAF H/F", { location: "Lyon" });
      const empty = await started();
      const kept = await started();

      await reports.record(empty.id, { stopped: true, jobOfferIds: [] });
      await reports.record(empty.id, { stopped: true, jobOfferIds: [] });
      await reports.record(kept.id, { stopped: true, jobOfferIds: [daf] });

      expect(await used()).toBe(1);
    });

    it("failed part-way, it keeps the Job Offers it had found (regression: they were dropped)", async () => {
      const daf = await capture("DAF H/F", { location: "Lyon" });
      const jobSearch = await started();

      await reports.record(jobSearch.id, { failed: "discovery_failed", jobOfferIds: [daf] });

      expect(await jobSearches.get(candidateId, jobSearch.id)).toMatchObject({ status: "failed", failure: "discovery_failed", results: [{ jobOffer: { id: daf } }] });
    });
  });

  describe("a Job Search's Provenance and live progress (#330)", () => {
    const at = "2026-10-15T08:00:01.000Z";
    const titles: ProvenanceEvent = { type: "step_started", id: 1, step: { kind: "ai", activity: "think", task: "job_titles", at } };
    const titlesEnded: ProvenanceEvent = {
      type: "step_ended",
      id: 1,
      step: { kind: "ai", activity: "think", task: "job_titles", provider: "anthropic", endpoint: "bedrock eu-north-1", model: "anthropic.claude-opus-5", tokens: { input: 900, output: 40 }, ms: 1200, at, outcome: "ok", count: 1 },
    };
    const franceTravail: ProvenanceEvent = { type: "step_started", id: 2, step: { kind: "tool", activity: "search", tool: "france-travail", at: "2026-10-15T08:00:02.200Z" } };
    const provenance: Provenance = {
      v: 1,
      steps: [
        (titlesEnded as Extract<ProvenanceEvent, { type: "step_ended" }>).step,
        { kind: "tool", activity: "search", tool: "france-travail", ms: 640, at: "2026-10-15T08:00:02.200Z", outcome: "ok", count: 1 },
        { kind: "rules", activity: "compute", rule: "match_score", ms: 2, at: "2026-10-15T08:00:09.000Z", outcome: "ok", count: 2 },
      ],
      sites: [{ kind: "web", domain: "francetravail.fr", links: ["https://candidat.francetravail.fr/offres/recherche/detail/123ABC"] }],
      startedAt: "2026-10-15T08:00:00.000Z",
      wallMs: 9100,
    };
    let reports: ReturnType<typeof createJobSearchReports>;
    beforeEach(() => {
      reports = createJobSearchReports(testAuth.auth.options.database as Pool, { quotas: billing, now: () => clock.now });
    });

    it("shows, on any page's poll, the steps the worker wrote of a Job Search still searching: each one's latest", async () => {
      const jobSearch = await started();

      await reports.progress(jobSearch.id, [titles]);
      await reports.progress(jobSearch.id, [titlesEnded, franceTravail]);

      expect((await jobSearches.notifications(candidateId)).running).toEqual([
        { jobSearchId: jobSearch.id, profile: { id: profileId, name: "DAF" }, startedAt: jobSearch.startedAt.toISOString(), steps: [titlesEnded, franceTravail] },
      ]);
      expect((await jobSearches.notifications(otherCandidateId)).running).toEqual([]);
    });

    it("keeps with a finished Job Search its Provenance, and its live steps are gone: nothing running to poll", async () => {
      const daf = await capture("DAF H/F", { location: "Lyon" });
      const jobSearch = await started();
      await reports.progress(jobSearch.id, [titlesEnded, franceTravail]);

      await reports.record(jobSearch.id, { jobOfferIds: [daf], provenance });

      expect((await jobSearches.get(candidateId, jobSearch.id))?.provenance).toEqual(provenance);
      expect(await jobSearches.notifications(candidateId)).toMatchObject({ searching: false, running: [] });
    });

    it("keeps with a failed Job Search the Provenance of the steps it ran", async () => {
      const jobSearch = await started();

      await reports.record(jobSearch.id, { failed: "discovery_failed", provenance });

      expect(await jobSearches.get(candidateId, jobSearch.id)).toMatchObject({ status: "failed", provenance });
    });

    it("writes no step once the Job Search is over", async () => {
      const jobSearch = await started();
      await reports.record(jobSearch.id, { jobOfferIds: [] });

      await reports.progress(jobSearch.id, [titles]);
      await reports.progress("not-a-uuid", [titles]);

      const { rows } = await (testAuth.auth.options.database as Pool).query("SELECT progress FROM job_search WHERE id = $1", [jobSearch.id]);
      expect(rows[0]).toEqual({ progress: null });
    });

    it("has none for a Job Search searching, failed before Job discovery ran, or recorded without one (« modèle non enregistré »), nor one naming an id", async () => {
      const searching = await started();
      const unavailable = await started();
      await reports.record(unavailable.id, { failed: "unavailable" });
      const naming = await started();
      const withId = { ...provenance, steps: [{ ...provenance.steps[1]!, candidateId }] } as unknown as Provenance;
      await reports.record(naming.id, { jobOfferIds: [], provenance: withId });

      for (const { id } of [searching, unavailable, naming]) expect((await jobSearches.get(candidateId, id))?.provenance).toBeNull();
    });
  });
});
