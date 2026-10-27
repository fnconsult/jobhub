/**
 * The Back Office Dashboard's Job discovery figures (#408, ADR-0042): what web search and Job discovery cost this
 * month so far (Paris time), against the monthly alert threshold and the run's budget.
 *
 *   const figures = await jobDiscoveryDashboard(database, { now, thresholdEur, runBudgetEur });
 *
 * One module in front of Postgres, reading what others record: AI Usage (`ai_usage`, through the same report as
 * Consommation IA, so the two always agree for the same month) and the Job Searches' Discovery metrics
 * (`job_search.metrics`). Read-only; nothing personal comes out, only sums and counts. A Job Digest top-up keeps no
 * record of its run yet (its metrics go to the log): its runs are not counted, its AI calls are (in the spend).
 */
import { SEARCH_PROVIDER_IDS, SEARCH_TASK } from "@jobhub/ai";
import { RUN_COST_ITEMS, RUN_STOP_REASONS, type RunCostItem, type RunStopReason } from "@jobhub/shared";
import type { Pool } from "pg";
import { aiUsageMonths, aiUsagePeriod, aiUsageReport } from "../ai-usage/index";

export interface JobDiscoveryDashboardSettings {
  now: Date;
  /** WEB_SEARCH_MONTHLY_ALERT_EUR in use; 0: no alert. */
  thresholdEur: number;
  /** JOB_DISCOVERY_BUDGET_EUR in use: what one run may spend. */
  runBudgetEur: number;
}

/** One day of the month so far: each Search provider's web search spend, the day's, and the month's until then. */
export interface WebSearchDay {
  /** "2026-10-09", Paris time. */
  day: string;
  byProvider: Partial<Record<string, number>>;
  totalEur: number;
  cumulativeEur: number;
}

export interface JobDiscoveryDashboard {
  /** "2026-10", Paris time. */
  month: string;
  /** The month's days, and how many of them have begun (today included). */
  daysInMonth: number;
  daysSoFar: number;
  webSearch: {
    /** What AI Usage recorded for the web_search task this month: Consommation IA's figure. */
    spendEur: number;
    thresholdEur: number;
    /** The month's spend at its pace so far. */
    monthEndEstimateEur: number;
    /** The Search providers with spend this month, in the catalog's order (others after, by name). */
    providers: string[];
    /** Every day of the month so far, the first first. */
    days: WebSearchDay[];
  };
  /** The month's Job discovery runs: its Job Searches that ran (done, stopped, or failed while searching). */
  runs: {
    count: number;
    /** JOB_DISCOVERY_BUDGET_EUR in use. */
    budgetEur: number;
    /** Null with no run. */
    averageCostEur: number | null;
    /** The Job Offers the runs found that were not stored before they started. */
    newJobOffers: number;
    /** Null with no new Job Offer. */
    costPerNewJobOfferEur: number | null;
    /** The runs that switched to the fallback Search provider (ADR-0043). */
    fellBack: number;
    /** How many runs ended each way, every way listed in order: `failed` while searching; `unknown` for one from before #408. */
    stopReasons: { reason: DashboardStopReason; runs: number }[];
    /** The runs that kept their cost by item (#408): `averageCostByItem` is over them, every item listed in order (0 with none). */
    itemizedRuns: number;
    averageCostByItem: { item: RunCostItem; eur: number }[];
  };
  /** The month's AI calls, as Consommation IA counts them: how many, how many failed, and the tools used with no known price. */
  calls: { calls: number; failures: number; unpricedTools: number };
}

/** Why a run ended, as the Dashboard counts it. */
export const DASHBOARD_STOP_REASONS = [...RUN_STOP_REASONS, "failed", "unknown"] as const;
export type DashboardStopReason = (typeof DASHBOARD_STOP_REASONS)[number];

const TIME_ZONE = "Europe/Paris";

/**
 * The month's Job Searches that ran: done, stopped, or failed while searching (not those Job discovery never ran for),
 * each with its Discovery metrics and how many of the Job Offers it found were stored after it started (new to it).
 */
const RUNS = `
  SELECT s.status, s.metrics,
         (SELECT count(*) FROM job_offer o WHERE o.id = ANY(s.job_offer_ids) AND o.created_at >= s.started_at)::int AS "newJobOffers"
    FROM job_search s
   WHERE s.started_at >= $1::timestamp AT TIME ZONE '${TIME_ZONE}' AND s.started_at < $2::timestamp AT TIME ZONE '${TIME_ZONE}'
     AND (s.status IN ('done', 'stopped') OR s.failure = 'discovery_failed')`;

interface RunRow {
  status: "done" | "stopped" | "failed";
  metrics: { costEur?: number; searchFallback?: unknown; stopReason?: string; costByItem?: Partial<Record<RunCostItem, number>> } | null;
  newJobOffers: number;
}

/** Why `run` ended, as the Dashboard counts it. */
function stopReasonOf(run: RunRow): DashboardStopReason {
  if (run.status === "failed") return "failed";
  if (run.status === "stopped") return "stopped";
  const recorded = run.metrics?.stopReason;
  return RUN_STOP_REASONS.includes(recorded as RunStopReason) ? (recorded as RunStopReason) : "unknown";
}

/** The runs' figures, from their rows. */
function runFigures(rows: RunRow[], budgetEur: number): JobDiscoveryDashboard["runs"] {
  const costEur = rows.reduce((sum, run) => sum + (run.metrics?.costEur ?? 0), 0);
  const newJobOffers = rows.reduce((sum, run) => sum + run.newJobOffers, 0);
  const itemized = rows.flatMap((run) => (run.metrics?.costByItem ? [run.metrics.costByItem] : []));
  return {
    count: rows.length,
    budgetEur,
    averageCostEur: rows.length === 0 ? null : costEur / rows.length,
    newJobOffers,
    costPerNewJobOfferEur: newJobOffers === 0 ? null : costEur / newJobOffers,
    fellBack: rows.filter((run) => typeof run.metrics?.searchFallback === "object" && run.metrics.searchFallback !== null).length,
    stopReasons: DASHBOARD_STOP_REASONS.map((reason) => ({ reason, runs: rows.filter((run) => stopReasonOf(run) === reason).length })),
    itemizedRuns: itemized.length,
    averageCostByItem: RUN_COST_ITEMS.map((item) => ({ item, eur: itemized.length === 0 ? 0 : itemized.reduce((sum, items) => sum + (items[item] ?? 0), 0) / itemized.length })),
  };
}

/** The web search spend per Paris day and provider: each call's tokens and tools' fees, as Consommation IA sums them. */
const WEB_SEARCH_DAYS = `
  SELECT to_char(u.at AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM-DD') AS day, coalesce(u.provider, '—') AS provider,
         sum(u.cost_eur + coalesce((SELECT sum(t.cost_eur) FROM ai_tool_usage t WHERE t.usage_id = u.id), 0)) AS eur
    FROM ai_usage u
   WHERE u.task = $3
     AND u.at >= $1::timestamp AT TIME ZONE '${TIME_ZONE}' AND u.at < $2::timestamp AT TIME ZONE '${TIME_ZONE}'
   GROUP BY 1, 2`;

/** The Search providers in the catalog's order, then any other by name. */
function inCatalogOrder(providers: Iterable<string>): string[] {
  const catalog: readonly string[] = SEARCH_PROVIDER_IDS;
  const rank = (provider: string) => (catalog.includes(provider) ? catalog.indexOf(provider) : catalog.length);
  return [...new Set(providers)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** This month's Job discovery figures so far, as the Back Office Dashboard shows them. */
export async function jobDiscoveryDashboard(database: Pick<Pool, "query">, settings: JobDiscoveryDashboardSettings): Promise<JobDiscoveryDashboard> {
  const month = aiUsageMonths(settings.now)[0]!;
  const period = aiUsagePeriod(month, settings.now);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(settings.now);
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const daysSoFar = Number(today.slice(8, 10));

  const [{ rows }, report, runs] = await Promise.all([
    database.query<{ day: string; provider: string; eur: number }>(WEB_SEARCH_DAYS, [period.from, period.to, SEARCH_TASK]),
    aiUsageReport(database, period),
    database.query<RunRow>(RUNS, [period.from, period.to]),
  ]);
  let cumulativeEur = 0;
  const days = Array.from({ length: daysSoFar }, (_, index): WebSearchDay => {
    const day = `${month}-${String(index + 1).padStart(2, "0")}`;
    const spent = rows.filter((row) => row.day === day);
    const totalEur = spent.reduce((sum, row) => sum + Number(row.eur), 0);
    cumulativeEur += totalEur;
    return { day, byProvider: Object.fromEntries(spent.map((row) => [row.provider, Number(row.eur)])), totalEur, cumulativeEur };
  });
  const spendEur = cumulativeEur;

  return {
    month,
    daysInMonth,
    daysSoFar,
    webSearch: {
      spendEur,
      thresholdEur: settings.thresholdEur,
      monthEndEstimateEur: (spendEur / daysSoFar) * daysInMonth,
      providers: inCatalogOrder(rows.filter((row) => Number(row.eur) > 0).map((row) => row.provider)),
      days,
    },
    runs: runFigures(runs.rows, settings.runBudgetEur),
    calls: { calls: report.totals.calls, failures: report.totals.failures, unpricedTools: report.tools.filter((tool) => tool.unpricedCalls > 0).length },
  };
}
