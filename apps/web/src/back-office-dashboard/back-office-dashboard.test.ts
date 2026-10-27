import type { UsageEntry } from "@jobhub/ai";
import { noDiscoveryMetrics, type DiscoveryMetrics, type MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiUsagePeriod, aiUsageReport, createPostgresUsageLog, migrateAiUsage } from "../ai-usage";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createBilling, migrateBilling, STARTING_PLAN_QUOTAS } from "../billing";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createJobSearches, migrateJobSearches, type JobSearchOutcome } from "../job-searches";
import { createProfiles, migrateProfiles } from "../profiles";
import { jobDiscoveryDashboard } from "./index";

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

/** One AI call, at `at`: a Mistral scoring call of €0.001 unless said otherwise. */
function call(at: string, overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    at: new Date(at),
    candidateId: null,
    task: "scoring",
    provider: "mistral",
    endpoint: "fake mistral",
    model: "mistral-small-latest",
    inputTokens: 10,
    outputTokens: 5,
    outcome: "ok",
    sent: true,
    durationMs: 12,
    costEur: 0.001,
    tools: [],
    transcript: { messages: [{ role: "user", content: "Score" }], reply: "82" },
    ...overrides,
  };
}

/** A web search on `provider`, billed `units` of its unit at `unitEur` each (null: « prix inconnu »). */
function search(at: string, provider: "perplexity" | "brave", units: number, unitEur: number | null, overrides: Partial<UsageEntry> = {}): UsageEntry {
  return call(at, {
    task: "web_search",
    provider,
    endpoint: `fake ${provider}`,
    model: provider,
    inputTokens: 0,
    outputTokens: 0,
    costEur: 0,
    tools: [{ name: "web_search", count: units, ok: true, durationMs: 300, costEur: unitEur === null ? null : units * unitEur }],
    ...overrides,
  });
}

describe.skipIf(!connectionString)("the Back Office Dashboard's Job discovery figures (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  /** The Candidate whose Job Searches the runs are, and their Profile: created with the first one. */
  let candidate: { id: string; profileId: string } | undefined;
  // Monday 26 October 2026, 10:00 in Paris: the month so far is 26 days of 31.
  const now = new Date("2026-10-26T09:00:00Z");
  const settings = { now, thresholdEur: 2, runBudgetEur: 0.08 };

  beforeEach(async () => {
    testAuth = await startTestAuth();
    candidate = undefined;
    database = testAuth.database;
    await migrateAiUsage(database);
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateBilling(database);
    await migrateJobSearches(database);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  /**
   * One Job Search started at `at` and ended with `outcome` and `metrics`; `found` names the Job Offers it found, each
   * first stored at the time given (a Job Offer stored before the run started is not new to it).
   */
  async function jobSearch(at: string, outcome: "done" | "stopped" | "discovery_failed" | "unavailable", metrics: Partial<DiscoveryMetrics>, found: string[] = []) {
    const clock = { now: new Date(at) };
    const billing = createBilling({ database, baseURL: "http://localhost:3000", now: () => clock.now });
    await billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, jobSearches: 100 });
    const profiles = createProfiles(database);
    const jobOffers = createJobOffers(database);
    const searches = createJobSearches(database, { profiles, jobOffers, applications: {} as never, quotas: billing, queue: { send: async () => undefined }, now: () => clock.now });
    candidate ??= await (async () => {
      const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      const id = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
      const created = await profiles.create(id, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"], remoteWorkOptions: [] } });
      if (!created.ok) throw new Error("fixture Profile refused");
      return { id, profileId: created.profile.id };
    })();
    const { id: candidateId, profileId } = candidate;
    const started = await searches.start(candidateId, { profileId });
    if (!started.ok) throw new Error(`fixture Job Search refused: ${JSON.stringify(started)}`);
    const jobOfferIds: string[] = [];
    for (const storedAt of found) {
      const captured = await jobOffers.capture({ source: { url: `https://carrieres.example.fr/${jobOfferIds.length}-${storedAt}` }, title: "DAF H/F", content: `DAF à Lyon, ${storedAt}.` }, "candidate");
      if (!captured.ok) throw new Error("fixture Job Offer refused");
      await database.query(`UPDATE job_offer SET created_at = $2 WHERE id = $1`, [captured.jobOffer.id, new Date(storedAt)]);
      jobOfferIds.push(captured.jobOffer.id);
    }
    clock.now = new Date(new Date(at).getTime() + 30_000);
    const measured = { ...noDiscoveryMetrics(), ...metrics };
    const ended: JobSearchOutcome =
      outcome === "done" ? { jobOfferIds, metrics: measured } : outcome === "stopped" ? { stopped: true, jobOfferIds, metrics: measured } : { failed: outcome, jobOfferIds, metrics: measured };
    await searches.record(started.jobSearch.id, ended);
  }

  async function record(...entries: UsageEntry[]) {
    const usage = createPostgresUsageLog(database);
    for (const entry of entries) await usage.record(entry);
  }

  it("sums the month's web search spend as Consommation IA does for the same month, day by day and per Search provider", async () => {
    await record(
      search("2026-10-01T06:00:00Z", "perplexity", 1, 0.00086),
      search("2026-10-01T07:00:00Z", "perplexity", 2, 0.00086),
      // Paris time: 9 October, 01:30, though still the 8th in UTC.
      search("2026-10-08T23:30:00Z", "brave", 1, 0.0043),
      search("2026-10-09T08:00:00Z", "perplexity", 1, 0.00086, { costEur: 0.0001 }),
      // Another task, and another month: not web search spend of October.
      call("2026-10-09T08:00:00Z"),
      search("2026-09-30T21:30:00Z", "perplexity", 5, 0.00086),
    );

    const dashboard = await jobDiscoveryDashboard(database, settings);
    const report = await aiUsageReport(database, aiUsagePeriod("2026-10", now));

    const consommationIa = report.byTask.find((row) => row.task === "web_search")!.costEur;
    expect(dashboard.webSearch.spendEur).toBeCloseTo(consommationIa, 12);
    expect(dashboard.webSearch.spendEur).toBeCloseTo(3 * 0.00086 + 0.0043 + 0.00086 + 0.0001, 12);
    expect(dashboard.month).toBe("2026-10");
    // In the catalog's order, so each keeps its colour from one month to the next.
    expect(dashboard.webSearch.providers).toEqual(["perplexity", "brave"]);
    expect(dashboard.webSearch.days).toHaveLength(26);
    expect(dashboard.webSearch.days[0]).toEqual({ day: "2026-10-01", byProvider: { perplexity: expect.closeTo(3 * 0.00086, 12) }, totalEur: expect.closeTo(3 * 0.00086, 12), cumulativeEur: expect.closeTo(3 * 0.00086, 12) });
    expect(dashboard.webSearch.days[8]).toEqual({
      day: "2026-10-09",
      byProvider: { brave: expect.closeTo(0.0043, 12), perplexity: expect.closeTo(0.00096, 12) },
      totalEur: expect.closeTo(0.00526, 12),
      cumulativeEur: expect.closeTo(dashboard.webSearch.spendEur, 12),
    });
    expect(dashboard.webSearch.days[25]).toMatchObject({ day: "2026-10-26", byProvider: {}, totalEur: 0 });
  });

  it("estimates the month's end at its pace so far, against the alert threshold", async () => {
    await record(search("2026-10-02T08:00:00Z", "perplexity", 1, 1.3));

    const dashboard = await jobDiscoveryDashboard(database, settings);

    expect(dashboard).toMatchObject({ daysInMonth: 31, daysSoFar: 26 });
    expect(dashboard.webSearch.thresholdEur).toBe(2);
    expect(dashboard.webSearch.monthEndEstimateEur).toBeCloseTo((1.3 / 26) * 31, 12);
  });

  it("counts the month's AI calls, the failed ones and the tools with no known price as Consommation IA does", async () => {
    await record(
      call("2026-10-03T08:00:00Z"),
      call("2026-10-03T09:00:00Z", { outcome: "failed", reason: "provider_unavailable" }),
      call("2026-10-04T09:00:00Z", { outcome: "warning", reason: "other" }),
      search("2026-10-05T08:00:00Z", "brave", 1, null),
      search("2026-10-05T09:00:00Z", "perplexity", 1, 0.00086),
      call("2026-09-20T09:00:00Z", { outcome: "failed", reason: "provider_unavailable" }),
    );

    const dashboard = await jobDiscoveryDashboard(database, settings);
    const report = await aiUsageReport(database, aiUsagePeriod("2026-10", now));

    expect(dashboard.calls).toEqual({ calls: report.totals.calls, failures: report.totals.failures, unpricedTools: 1 });
    expect(dashboard.calls).toEqual({ calls: 5, failures: 1, unpricedTools: 1 });
  });

  describe("the month's Job discovery runs: its Job Searches", () => {
    const items = (page_reading: number, plan: number, web_search: number, target_companies: number) => ({ page_reading, plan, web_search, target_companies });
    const fellBack = { from: "perplexity", to: "brave", reason: "rate_limited" };

    async function seedRuns() {
      await jobSearch("2026-10-03T08:00:00Z", "done", { costEur: 0.04, stopReason: "job_offers", costByItem: items(0.03, 0.004, 0.002, 0.004), searchFallback: fellBack }, [
        "2026-10-03T08:00:10Z",
        "2026-10-03T08:00:20Z",
        // Stored by an earlier run: found again, not new.
        "2026-09-12T08:00:00Z",
      ]);
      await jobSearch("2026-10-05T08:00:00Z", "stopped", { costEur: 0.02, stopReason: "stopped", costByItem: items(0.015, 0.003, 0.002, 0), searchFallback: null }, ["2026-10-05T08:00:10Z"]);
      await jobSearch("2026-10-06T08:00:00Z", "discovery_failed", { costEur: 0.01, costByItem: items(0.006, 0.003, 0.001, 0) });
      // A run from before stop reasons and items were kept.
      await jobSearch("2026-10-07T08:00:00Z", "done", { costEur: 0.03 });
      // Job discovery never ran: not a run.
      await jobSearch("2026-10-08T08:00:00Z", "unavailable", {});
      // Last month's.
      await jobSearch("2026-09-28T08:00:00Z", "done", { costEur: 0.5, stopReason: "spend", costByItem: items(0.5, 0, 0, 0) });
    }

    it("counts the runs, their average cost against the run budget, and their cost per new Job Offer", async () => {
      await seedRuns();

      const { runs } = await jobDiscoveryDashboard(database, settings);

      expect(runs).toMatchObject({ count: 4, budgetEur: 0.08, newJobOffers: 3, fellBack: 1 });
      expect(runs.averageCostEur).toBeCloseTo((0.04 + 0.02 + 0.01 + 0.03) / 4, 12);
      expect(runs.costPerNewJobOfferEur).toBeCloseTo(0.1 / 3, 12);
    });

    it("says why the runs stopped, every reason listed, failed and unrecorded ones apart", async () => {
      await seedRuns();

      const { runs } = await jobDiscoveryDashboard(database, settings);

      expect(runs.stopReasons).toEqual([
        { reason: "job_offers", runs: 1 },
        { reason: "spend", runs: 0 },
        { reason: "duration", runs: 0 },
        { reason: "searches_done", runs: 0 },
        { reason: "stopped", runs: 1 },
        { reason: "failed", runs: 1 },
        { reason: "unknown", runs: 1 },
      ]);
    });

    it("averages a run's cost by item over the runs that kept it", async () => {
      await seedRuns();

      const { runs } = await jobDiscoveryDashboard(database, settings);

      expect(runs.itemizedRuns).toBe(3);
      expect(runs.averageCostByItem).toEqual([
        { item: "page_reading", eur: expect.closeTo((0.03 + 0.015 + 0.006) / 3, 12) },
        { item: "plan", eur: expect.closeTo((0.004 + 0.003 + 0.003) / 3, 12) },
        { item: "web_search", eur: expect.closeTo((0.002 + 0.002 + 0.001) / 3, 12) },
        { item: "target_companies", eur: expect.closeTo(0.004 / 3, 12) },
      ]);
    });

    it("has no average with no run this month", async () => {
      const { runs } = await jobDiscoveryDashboard(database, settings);

      expect(runs).toMatchObject({ count: 0, averageCostEur: null, newJobOffers: 0, costPerNewJobOfferEur: null, fellBack: 0, itemizedRuns: 0 });
      expect(runs.averageCostByItem.map((row) => row.eur)).toEqual([0, 0, 0, 0]);
    });
  });
});
