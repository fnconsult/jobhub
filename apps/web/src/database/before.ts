/**
 * SQL for the instant `interval` before `now` (a timestamptz expression, such as `$1`), counted in UTC.
 *
 * Subtracting a `make_interval(months => 24)` from a timestamptz counts days, months and years in the session's TimeZone,
 * so across a daylight-saving change the instant it gives moves by an hour with the Postgres server's
 * setting: on a server set to Europe/Paris, a 24-month retention purged an email received at 09:30 UTC
 * at 09:29 UTC two years later. Counted in UTC, a cutoff is the same instant on every server.
 */
export function utcBefore(now: string, interval: string): string {
  return `((${now}::timestamptz AT TIME ZONE 'UTC') - ${interval}) AT TIME ZONE 'UTC'`;
}
