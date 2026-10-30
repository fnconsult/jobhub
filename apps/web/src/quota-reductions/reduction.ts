import { JOB_DIGEST_FREQUENCIES, type JobDigestFrequency, type PlanQuotas } from "@jobhub/shared";

/** Where a Quota Reduction's dates are read: its effective date starts at midnight there. */
export const REDUCTION_TIME_ZONE = "Europe/Paris";

/** How many days ahead of its effective date a Quota Reduction is announced, at the least (L224-25-26, #514). */
export const NOTICE_DAYS = 30;

/** How long after the effective date a subscriber told of it may still cancel with a prorata refund. */
export const RESOLUTION_DAYS_AFTER = 30;

/** One quota a Quota Reduction lowers: what it was when scheduled, and what it becomes. */
export type QuotaReductionStep<K extends keyof PlanQuotas = keyof PlanQuotas> = { before: PlanQuotas[K]; after: PlanQuotas[K] };

/** The quotas a Quota Reduction lowers, each with its before and after. */
export type ReducedQuotas = { [K in keyof PlanQuotas]?: QuotaReductionStep<K> };

/** Whether `after` gives less than `before`: a lower number, a number where it was unlimited (null), a rarer Job Digest. */
function lowers(before: number | null | JobDigestFrequency, after: number | null | JobDigestFrequency): boolean {
  if (typeof before === "string" || typeof after === "string") {
    return JOB_DIGEST_FREQUENCIES.indexOf(after as JobDigestFrequency) < JOB_DIGEST_FREQUENCIES.indexOf(before as JobDigestFrequency);
  }
  if (after === null) return false;
  return before === null || after < before;
}

/**
 * Splits a change of one Plan's quotas: what may apply now (every increase, and what does not change), and the
 * quotas it lowers, which wait for their effective date on a Plan with subscribers.
 */
export function splitQuotaChange(before: PlanQuotas, after: PlanQuotas): { now: PlanQuotas; reduced: ReducedQuotas } {
  const now = { ...after };
  const reduced: Record<string, QuotaReductionStep> = {};
  for (const key of Object.keys(after) as (keyof PlanQuotas)[]) {
    if (!lowers(before[key], after[key])) continue;
    reduced[key] = { before: before[key], after: after[key] };
    (now as Record<string, unknown>)[key] = before[key];
  }
  return { now, reduced: reduced as ReducedQuotas };
}

/** "2026-10-15": the day `at` falls on in Paris. */
export function dayInParis(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: REDUCTION_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The day `days` after `day` ("2026-10-15"). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The earliest effective date a Quota Reduction scheduled at `now` may have: NOTICE_DAYS after today in Paris. */
export function earliestEffectiveOn(now: Date): string {
  return addDays(dayInParis(now), NOTICE_DAYS);
}

/** How far Paris is ahead of UTC at `at`, in milliseconds. */
function parisOffset(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: REDUCTION_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) - at.getTime();
}

/** The instant an effective date ("2026-11-14") starts: midnight in Paris. Null for anything that is no date. */
export function effectiveAtOf(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const midnightUTC = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(midnightUTC.getTime()) || midnightUTC.toISOString().slice(0, 10) !== day) return null;
  return new Date(midnightUTC.getTime() - parisOffset(midnightUTC));
}
