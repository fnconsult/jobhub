import { noDiscoveryMetrics, type DiscoveryMetrics, type DiscoverySearch, type MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice } from "../admin/back-office";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateBilling } from "../billing";
import { migrateJobOffers } from "../job-offers";
import { migrateJobSearches } from "../job-searches";
import { createProfiles, migrateProfiles } from "../profiles";
import { createDiscoveryRuns, discoveryRunsOf, migrateDiscoveryRuns, purgeExpiredDiscoveryRuns, type DiscoveryRunRecord, type DiscoveryRuns } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: [],
  languages: [],
};

const QUERY_FR = "Offre d'emploi « Directrice financière » à Lyon, CDI";
const QUERY_EN = 'Job offer "Chief Financial Officer" in Lyon, permanent contract';
const QUERY_SITE = "Offre d'emploi « Directrice financière » à Lyon, CDI";

const searches: DiscoverySearch[] = [
  { kind: "plan", queries: [QUERY_FR, QUERY_EN], page: 1, provider: "perplexity", fallback: false, results: 12, newJobOffers: 4, costEur: 0.00086 },
  { kind: "plan", queries: [QUERY_FR, QUERY_EN], page: 2, provider: "brave", fallback: true, results: 9, newJobOffers: 2, costEur: 0.0043 },
  { kind: "site", site: "apec.fr", queries: [QUERY_SITE], page: 1, provider: "brave", fallback: true, results: 3, newJobOffers: 1, costEur: 0.0043 },
];

const metrics: DiscoveryMetrics = {
  ...noDiscoveryMetrics(),
  funnel: { providerUrls: 24, fetched: 18, extracted: 11, alreadyStored: 3, afterDedup: 12, matched: 5 },
  skipped: { ...noDiscoveryMetrics().skipped, robots: 2, too_old: 4 },
  costEur: 0.0312,
  fantasticJobs: { status: "searched", offers: 2, calls: 1, costEur: 0.004 },
  searchFallback: { from: "perplexity", to: "brave", reason: "rate_limited" },
};

describe.skipIf(!connectionString)("Job discovery runs, as Activité › Recherches shows them (#404; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let runs: DiscoveryRuns;
  let backOffice: BackOffice;
  let marie: string;
  let profileId: string;
  let jobSearchId: string;
  const admin = { id: "", email: "admin@jobbbox.example" };

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  const run = (more: Partial<DiscoveryRunRecord> = {}): DiscoveryRunRecord => ({
    trigger: "job_search",
    startedAt: new Date("2026-10-26T15:02:00Z"),
    durationMs: 47_000,
    candidateId: marie,
    profileId,
    jobSearchId,
    criteria: { targetRole: "Directrice financière", locations: ["Lyon", "Villeurbanne"], contractTypes: ["cdi"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
    metrics,
    stopReason: "job_offers",
    newJobOffers: 7,
    searches,
    ...more,
  });

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateBilling(database);
    await migrateJobSearches(database);
    await migrateBackOfficeAudit(database);
    await migrateDiscoveryRuns(database);
    await migrateDiscoveryRuns(database); // safe to run twice
    marie = await candidate("marie.dupont@example.fr");
    admin.id = await candidate(admin.email);
    const created = await createProfiles(database).create(marie, { masterCv, searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: ["cdi"], remoteWorkOptions: [] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    profileId = created.profile.id;
    jobSearchId = (
      await database.query<{ id: string }>(`INSERT INTO job_search (candidate_id, profile_id, status, started_at) VALUES ($1, $2, 'done', now()) RETURNING id`, [marie, profileId])
    ).rows[0]!.id;
    backOffice = createBackOffice(database, { billing: {} as never, humanCoaches: {} as never });
    runs = createDiscoveryRuns(database, { backOffice, now: () => new Date("2026-10-27T09:00:00Z") });
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("lists a run: when, trigger, the Profile by pseudonym with its criteria, searches, providers with the fallback, pages read, new and extracted Job Offers, stop reason, duration, cost", async () => {
    const id = await runs.record(run());

    const [listed, ...more] = await runs.list();

    expect(more).toEqual([]);
    expect(listed).toEqual({
      id,
      startedAt: new Date("2026-10-26T15:02:00Z"),
      trigger: "job_search",
      profile: { pseudonym: expect.stringMatching(/^[0-9a-f]{4}$/), targetRole: "Directrice financière", locations: ["Lyon", "Villeurbanne"] },
      searches: 3,
      providers: ["perplexity", "brave"],
      fallback: { from: "perplexity", to: "brave", reason: "rate_limited" },
      pagesRead: 18,
      newJobOffers: 7,
      extracted: 11,
      stopReason: "job_offers",
      durationMs: 47_000,
      // The AI calls' and Fantastic.jobs' estimated costs.
      costEur: expect.closeTo(0.0352, 6),
    });
    // No Candidate here: neither their email nor their name.
    expect(JSON.stringify(await runs.list())).not.toMatch(/marie|Dupont/i);
  });

  it("gives the same pseudonym to every run of a Profile, and another to another Profile", async () => {
    const other = await createProfiles(database).create(marie, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Paris"], contractTypes: [], remoteWorkOptions: [] } });
    if (!other.ok) throw new Error("fixture Profile refused");
    await runs.record(run());
    await runs.record(run({ trigger: "job_digest", jobSearchId: null }));
    await runs.record(run({ profileId: other.profile.id, jobSearchId: null }));

    const pseudonyms = (await runs.list()).map((listed) => listed.profile?.pseudonym);

    expect(new Set(pseudonyms).size).toBe(2);
  });

  it("opens a run with its Discovery metrics, each search with its query texts, and its Skip reasons", async () => {
    const id = await runs.record(run());

    const opened = await runs.get(id);

    expect(opened).toMatchObject({
      id,
      metrics,
      searches: [
        { kind: "plan", queries: [QUERY_FR, QUERY_EN], page: 1, provider: "perplexity", fallback: false, results: 12, newJobOffers: 4, costEur: 0.00086 },
        { kind: "plan", queries: [QUERY_FR, QUERY_EN], page: 2, provider: "brave", fallback: true, results: 9, newJobOffers: 2, costEur: 0.0043 },
        { kind: "site", site: "apec.fr", queries: [QUERY_SITE], page: 1, provider: "brave", fallback: true, results: 3, newJobOffers: 1, costEur: 0.0043 },
      ],
      queriesKept: true,
      candidateId: marie,
      hasJobSearch: true,
    });
    expect(await runs.get("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await runs.get("not-an-id")).toBeNull();
  });

  it("filters by trigger, by period and to the runs that fell back, newest first", async () => {
    const older = await runs.record(run({ startedAt: new Date("2026-10-10T08:00:00Z"), metrics: { ...metrics, searchFallback: null } }));
    const digest = await runs.record(run({ trigger: "job_digest", jobSearchId: null, startedAt: new Date("2026-10-27T05:00:00Z"), metrics: { ...metrics, searchFallback: null } }));
    const fellBack = await runs.record(run({ startedAt: new Date("2026-10-26T15:02:00Z") }));
    const ids = async (filter: unknown) => (await runs.list(filter)).map((listed) => listed.id);

    // Default: the last 7 days.
    expect(await ids({})).toEqual([digest, fellBack]);
    expect(await ids({ period: "30d" })).toEqual([digest, fellBack, older]);
    expect(await ids({ period: "today" })).toEqual([digest]);
    expect(await ids({ period: "all", trigger: "job_search" })).toEqual([fellBack, older]);
    expect(await ids({ period: "all", fallback: "1" })).toEqual([fellBack]);
    // What cannot be read is left out.
    expect(await ids({ period: "forever", trigger: "cron", fallback: "maybe" })).toEqual([digest, fellBack]);
  });

  describe("kept 30 days for its query texts and Job Search link, 24 months for its figures", () => {
    it("purges a run's query texts and its link to the Job Search after 30 days, and keeps its figures", async () => {
      const id = await runs.record(run({ startedAt: new Date("2026-09-26T15:00:00Z") }));
      const recent = await runs.record(run({ startedAt: new Date("2026-09-28T15:00:00Z") }));

      expect(await purgeExpiredDiscoveryRuns(database, new Date("2026-10-27T09:00:00Z"))).toEqual({ queries: 1, runs: 0 });

      const purged = await runs.get(id);
      expect(purged).toMatchObject({
        profile: null,
        searches: searches.map(({ queries: _queries, ...figures }) => ({ ...figures, queries: [] })),
        queriesKept: false,
        candidateId: null,
        hasJobSearch: false,
        metrics,
        newJobOffers: 7,
        stopReason: "job_offers",
        durationMs: 47_000,
      });
      expect(JSON.stringify(purged)).not.toContain("Directrice");
      expect((await runs.get(recent))?.queriesKept).toBe(true);
    });

    it("purges a run's figures after 24 months", async () => {
      await runs.record(run({ startedAt: new Date("2024-10-26T08:00:00Z") }));
      await runs.record(run({ startedAt: new Date("2024-10-28T08:00:00Z") }));

      expect(await purgeExpiredDiscoveryRuns(database, new Date("2026-10-27T09:00:00Z"))).toEqual({ queries: 2, runs: 1 });
      expect(await runs.list({ period: "all" })).toHaveLength(1);
    });

    it("deletes a run's query texts with the Candidate's account, and keeps its figures, of no one", async () => {
      const id = await runs.record(run());

      await database.query("DELETE FROM candidate WHERE id = $1", [marie]);

      expect(await runs.get(id)).toMatchObject({ queriesKept: false, candidateId: null, profile: null, newJobOffers: 7 });
    });

    it("puts a Candidate's runs in their Data export: when, why, and each search's query texts, never another's", async () => {
      const id = await runs.record(run());
      const other = await candidate("someone.else@example.fr");

      expect(await discoveryRunsOf(database, marie)).toEqual([
        {
          id,
          profileId,
          startedAt: new Date("2026-10-26T15:02:00Z"),
          trigger: "job_search",
          jobSearchId,
          criteria: run().criteria,
          searches: searches.map(({ kind, site, queries, page, provider }) => ({ kind, ...(site ? { site } : {}), queries, page, provider })),
        },
      ]);
      expect(await discoveryRunsOf(database, other)).toEqual([]);
    });
  });

  describe("the Job Search behind a run, opened by a super-admin", () => {
    it("is opened with the view written to the Back Office Audit, naming the run", async () => {
      const id = await runs.record(run());

      expect(await runs.openJobSearch(admin, id)).toEqual({ candidateId: marie, jobSearchId });

      expect(await backOffice.journal({ section: "discovery_runs" })).toEqual([
        expect.objectContaining({ actor: { candidateId: admin.id, email: admin.email }, section: "discovery_runs", target: id, action: "viewed" }),
      ]);
    });

    it("opens nothing, and records nothing, once its link is purged, for a Job Digest's run, or for no run", async () => {
      const digest = await runs.record(run({ trigger: "job_digest", jobSearchId: null }));
      const old = await runs.record(run({ startedAt: new Date("2026-09-01T08:00:00Z") }));
      await purgeExpiredDiscoveryRuns(database, new Date("2026-10-27T09:00:00Z"));

      expect(await runs.openJobSearch(admin, digest)).toBeNull();
      expect(await runs.openJobSearch(admin, old)).toBeNull();
      expect(await runs.openJobSearch(admin, "not-an-id")).toBeNull();
      expect(await backOffice.journal({ section: "discovery_runs" })).toEqual([]);
    });
  });
});
