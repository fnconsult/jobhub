import type { UsageEntry } from "@jobhub/ai";
import { noDiscoveryMetrics, type DiscoveryMetrics, type DiscoveryStopReason } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiUsagePeriod, aiUsageReport, createPostgresUsageLog, migrateAiUsage } from "../ai-usage";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateBilling } from "../billing";
import { migrateDiscoveryRuns } from "../discovery-runs";
import { migrateJobOffers } from "../job-offers";
import { migrateJobSearches } from "../job-searches";
import { migrateProfiles } from "../profiles";
import { jobDiscoveryDashboard } from "./index";

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
  // Monday 26 October 2026, 10:00 in Paris: the month so far is 26 days of 31.
  const now = new Date("2026-10-26T09:00:00Z");
  const settings = { now, thresholdEur: 2, runBudgetEur: 0.08 };

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateAiUsage(database);
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateBilling(database);
    await migrateJobSearches(database);
    await migrateDiscoveryRuns(database);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  /** One Discovery run (#404) started at `at`, as the worker records it: its figures, which name no one. */
  async function run(at: string, stopReason: DiscoveryStopReason, newJobOffers: number, metrics: Partial<DiscoveryMetrics>, trigger: "job_search" | "job_digest" = "job_search") {
    await database.query(
      `INSERT INTO discovery_run (started_at, trigger, duration_ms, stop_reason, new_job_offers, metrics, searches) VALUES ($1, $2, 30000, $3, $4, $5, '[]')`,
      [new Date(at), trigger, stopReason, newJobOffers, JSON.stringify({ ...noDiscoveryMetrics(), ...metrics })],
    );
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

  describe("the month's Job discovery runs: its Discovery runs, Job Searches' and Job Digest top-ups'", () => {
    const items = (page_reading: number, plan: number, web_search: number, target_companies: number) => ({ page_reading, plan, web_search, target_companies });
    const fellBack = { from: "perplexity", to: "brave", reason: "rate_limited" };

    async function seedRuns() {
      await run("2026-10-03T08:00:00Z", "job_offers", 2, { costEur: 0.04, costByItem: items(0.03, 0.004, 0.002, 0.004), searchFallback: fellBack });
      await run("2026-10-05T08:00:00Z", "stopped", 1, { costEur: 0.02, costByItem: items(0.015, 0.003, 0.002, 0), searchFallback: null });
      await run("2026-10-06T08:00:00Z", "failed", 0, { costEur: 0.01, costByItem: items(0.006, 0.003, 0.001, 0) });
      // A Job Digest's top-up, from before items were kept.
      await run("2026-10-07T08:00:00Z", "exhausted", 0, { costEur: 0.03 }, "job_digest");
      // Last month's.
      await run("2026-09-28T08:00:00Z", "spend", 4, { costEur: 0.5, costByItem: items(0.5, 0, 0, 0) });
    }

    it("counts the runs, their average cost against the run budget, and their cost per new Job Offer", async () => {
      await seedRuns();

      const { runs } = await jobDiscoveryDashboard(database, settings);

      expect(runs).toMatchObject({ count: 4, budgetEur: 0.08, newJobOffers: 3, fellBack: 1 });
      expect(runs.averageCostEur).toBeCloseTo((0.04 + 0.02 + 0.01 + 0.03) / 4, 12);
      expect(runs.costPerNewJobOfferEur).toBeCloseTo(0.1 / 3, 12);
    });

    it("says why the runs stopped, every reason listed", async () => {
      await seedRuns();

      const { runs } = await jobDiscoveryDashboard(database, settings);

      expect(runs.stopReasons).toEqual([
        { reason: "job_offers", runs: 1 },
        { reason: "spend", runs: 0 },
        { reason: "duration", runs: 0 },
        { reason: "exhausted", runs: 1 },
        { reason: "stopped", runs: 1 },
        { reason: "failed", runs: 1 },
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
