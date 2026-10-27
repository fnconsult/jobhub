/**
 * The Back Office Dashboard's Job discovery figures (#408, ADR-0042): what web search and Job discovery cost this
 * month so far (Paris time), against the monthly alert threshold and the run's budget.
 *
 *   const figures = await jobDiscoveryDashboard(database, { now, thresholdEur, runBudgetEur });
 *
 * One module in front of Postgres, reading what others record: AI Usage (`ai_usage`, through the same report as
 * Consommation IA, so the two always agree for the same month) and the Job Searches' Discovery metrics
 * (`job_search.metrics`). Read-only; nothing personal comes out, only sums and counts.
 */
import { SEARCH_PROVIDER_IDS, SEARCH_TASK } from "@jobhub/ai";
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
  /** The month's AI calls, as Consommation IA counts them: how many, how many failed, and the tools used with no known price. */
  calls: { calls: number; failures: number; unpricedTools: number };
}

const TIME_ZONE = "Europe/Paris";

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

  const [{ rows }, report] = await Promise.all([
    database.query<{ day: string; provider: string; eur: number }>(WEB_SEARCH_DAYS, [period.from, period.to, SEARCH_TASK]),
    aiUsageReport(database, period),
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
    calls: { calls: report.totals.calls, failures: report.totals.failures, unpricedTools: report.tools.filter((tool) => tool.unpricedCalls > 0).length },
  };
}
