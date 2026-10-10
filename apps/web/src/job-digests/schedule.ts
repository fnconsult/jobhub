/**
 * When Job Digests go out: daily ones at 07:00 Europe/Paris, weekly ones on
 * Monday at 07:00 Europe/Paris. Pure, so the worker's cron (which fires at
 * that hour) and the Job Digests module agree on what "due" means.
 */
import type { JobDigestFrequency } from "@jobhub/shared";

export const DIGEST_TIME_ZONE = "Europe/Paris";
export const DIGEST_HOUR = 7;

const DAY_MS = 86_400_000;

const wallClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: DIGEST_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The Paris wall-clock time at `at`, written as if it were UTC. */
function parisAsUtc(at: number): number {
  const part = Object.fromEntries(wallClock.formatToParts(at).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(part.year!, part.month! - 1, part.day!, part.hour!, part.minute!, part.second!);
}

/** The instant it is `hour`:00 in Paris on the calendar day `day` (a UTC midnight). 07:00 never falls in a change of time. */
function parisInstant(day: number, hour: number): Date {
  const wanted = day + hour * 3_600_000;
  let instant = wanted - (parisAsUtc(wanted) - wanted);
  instant = wanted - (parisAsUtc(instant) - instant);
  return new Date(instant);
}

/**
 * The latest moment at or before `at` when a Job Digest of this frequency goes
 * out. One is due when it has not run since then.
 */
export function latestSlot(frequency: Exclude<JobDigestFrequency, "none">, at: Date): Date {
  const local = parisAsUtc(at.getTime());
  let day = Math.floor(local / DAY_MS) * DAY_MS;
  if (local - day < DIGEST_HOUR * 3_600_000) day -= DAY_MS;
  if (frequency === "weekly") {
    const sinceMonday = (new Date(day).getUTCDay() + 6) % 7;
    day -= sinceMonday * DAY_MS;
  }
  return parisInstant(day, DIGEST_HOUR);
}
