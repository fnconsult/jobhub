import type { JobDigestFrequency, PlanQuotas, WeeklyQuota } from "@jobhub/shared";

/** The sidebar's order: Match Scores, ATS Scores, Job Searches, Enriched Contacts (the Job Digest after them). */
const METER_QUOTAS = ["matchScores", "atsScores", "jobSearches", "enrichedContacts"] as const satisfies readonly WeeklyQuota[];

/** One weekly Plan Quota in the Usage Meter's detail: a null limit is unlimited, 0 not included. */
export type UsageMeterQuota = { quota: WeeklyQuota; used: number; limit: number | null };

/** What the sidebar's Usage Meter shows: one bar for the week, and each quota's detail. */
export interface UsageMeter {
  /** Uses this week, each counted up to its quota's limit, over every limited quota the Plan grants. */
  used: number;
  /** All the uses the Plan grants this week, across its limited quotas. */
  allowed: number;
  /** `used` out of `allowed`, rounded; null when the Plan limits nothing (no bar to fill). */
  percent: number | null;
  quotas: UsageMeterQuota[];
  jobDigest: JobDigestFrequency;
}

/**
 * The Candidate's week of Plan Quotas as one bar (ADR-0031): every limited quota weighs
 * what the Plan grants of it, so 2 of 3 Match Scores and 1 of 4 Job Searches fill 3 of 7.
 * Unlimited and not-included quotas, and the Job Digest (a frequency), weigh nothing.
 */
export function usageMeter(quotas: PlanQuotas, usedThisWeek: Record<WeeklyQuota, number>): UsageMeter {
  const rows = METER_QUOTAS.map((quota) => ({ quota, used: usedThisWeek[quota], limit: quotas[quota] }));
  const limited = rows.filter((row): row is UsageMeterQuota & { limit: number } => row.limit !== null && row.limit > 0);
  const used = limited.reduce((sum, row) => sum + Math.min(row.used, row.limit), 0);
  const allowed = limited.reduce((sum, row) => sum + row.limit, 0);
  return {
    used,
    allowed,
    percent: allowed === 0 ? null : Math.round((100 * used) / allowed),
    quotas: rows,
    jobDigest: quotas.jobDigest,
  };
}
