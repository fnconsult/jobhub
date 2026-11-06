/**
 * The Consumption backfill (#800, ADR-0091): a one-off rebuild of the days before #799's deploy date, so « Votre
 * consommation » does not open empty. Run once per environment (docs/ops/consumption-backfill.md).
 *
 * It counts what the database still holds, each use on its French day:
 *  - an AI Coach reply: each `coach_message` the AI Coach wrote;
 *  - a Job Search: each one its Plan Quota use was kept for (done, or stopped with a Job Offer, or still searching);
 *  - a Tailored CV: the proposal under review, and the one saved; a Tailored Document: each draft;
 *  - a Company Dossier: each one built; a CV reading: each Master CV Version read from a file (with its Provenance);
 *  - an ATS Score: the one kept per Profile; an Enriched Contact: each one whose details were retrieved;
 *  - and, for the Tools with a weekly Plan Quota, the week's uses no stored result shows (every Match Score, which
 *    no result keeps; the ATS Scores replaced since): on the week's Monday, the day the Plan Quota week is kept under.
 * What was deleted (an Application, an « Effacer » conversation) cannot be counted: a best effort.
 *
 * It writes only the days from RETENTION_MONTHS ago to the day before `liveFrom`, replacing what it wrote there
 * before: run again, it gives the same rows; the days counted live, from `liveFrom`, are never touched.
 *
 * It refuses a `liveFrom` later than the earliest day already counted live, which it would otherwise overwrite: on
 * the first run, the earliest day in `consumption_day` (all of it live then); on later runs, the `liveFrom` the first
 * run recorded in `consumption_backfill`, which a later run must repeat.
 */
import { QUOTA_CONSUMPTION_TOOLS, consumptionTools, type ConsumptionTool } from "@jobhub/shared";
import type { Pool } from "pg";
import { inTransaction } from "../database/pool";
import { dayInFrance, RETENTION_MONTHS } from "./index";

export interface ConsumptionBackfill {
  /** The first day written, RETENTION_MONTHS ago. */
  from: string;
  /** The first day counted live, never written: #799's deploy date. */
  until: string;
  /** How many rows (Candidate, day, Tool) were written. */
  rows: number;
  /** How many uses of each Tool were written. */
  uses: Record<ConsumptionTool, number>;
}

/** Each stored result that marks one use: its Candidate, its Tool, and when it was used. */
const STORED_USES = `
  SELECT c.candidate_id, 'coach' AS tool, m.created_at AS at
    FROM coach_message m JOIN coach_conversation c ON c.id = m.conversation_id WHERE m.author = 'coach'
  UNION ALL
  SELECT candidate_id, 'jobSearch', started_at FROM job_search
   WHERE status IN ('done', 'searching') OR (status = 'stopped' AND cardinality(job_offer_ids) > 0)
  UNION ALL
  SELECT a.candidate_id, 'tailoredCv', (t.proposal ->> 'proposedAt')::timestamptz
    FROM tailored_cv t JOIN application a ON a.id = t.application_id WHERE t.proposal ? 'proposedAt'
  UNION ALL
  SELECT a.candidate_id, 'tailoredCv', (t.saved ->> 'savedAt')::timestamptz
    FROM tailored_cv t JOIN application a ON a.id = t.application_id WHERE t.saved ? 'savedAt'
  UNION ALL
  SELECT a.candidate_id, 'tailoredDocument', d.drafted_at FROM tailored_document d JOIN application a ON a.id = d.application_id
  UNION ALL
  SELECT a.candidate_id, 'companyDossier', COALESCE((d.dossier ->> 'builtAt')::timestamptz, d.updated_at)
    FROM company_dossier d JOIN application a ON a.id = d.application_id WHERE d.dossier IS NOT NULL
  UNION ALL
  SELECT p.candidate_id, 'cvReading', v.created_at FROM master_cv_version v JOIN profile p ON p.id = v.profile_id WHERE v.provenance IS NOT NULL
  UNION ALL
  SELECT p.candidate_id, 'atsScore', s.computed_at FROM ats_score s JOIN profile p ON p.id = s.profile_id
  UNION ALL
  SELECT a.candidate_id, 'enrichedContact', e.retrieved_at FROM enriched_contact e JOIN application a ON a.id = e.application_id WHERE e.retrieved_at IS NOT NULL`;

/**
 * Rebuilds Consumption from RETENTION_MONTHS before `now` (French time) to the day before `liveFrom` ("2026-11-06",
 * the day #799 was deployed in this environment, from which uses are counted live), in one transaction.
 */
export async function backfillConsumption(database: Pool, { liveFrom, now }: { liveFrom: string; now: Date }): Promise<ConsumptionBackfill> {
  const today = dayInFrance(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(liveFrom) || Number.isNaN(Date.parse(`${liveFrom}T00:00:00Z`))) {
    throw new Error(`#799's deploy date is a day, YYYY-MM-DD: not "${liveFrom}"`);
  }
  if (liveFrom > today) throw new Error(`#799's deploy date ${liveFrom} is still to come (today is ${today}): its days would be counted live`);

  return inTransaction(database, async (client) => {
    const { rows: range } = await client.query<{ from: string }>(`SELECT ($1::date - make_interval(months => $2))::date::text AS from`, [today, RETENTION_MONTHS]);
    const from = range[0]!.from;
    await client.query(`LOCK TABLE consumption_backfill IN EXCLUSIVE MODE`);
    const { rows: recorded } = await client.query<{ liveFrom: string }>(`SELECT live_from::text AS "liveFrom" FROM consumption_backfill LIMIT 1`);
    if (recorded[0]) {
      if (recorded[0].liveFrom !== liveFrom) {
        throw new Error(`#799's deploy date was ${recorded[0].liveFrom} on the first run, not ${liveFrom}: run again with --live-from ${recorded[0].liveFrom}`);
      }
    } else {
      const { rows: earliest } = await client.query<{ day: string | null }>(`SELECT min(day)::text AS day FROM consumption_day`);
      const earliestLive = earliest[0]?.day;
      if (earliestLive && liveFrom > earliestLive) {
        throw new Error(
          `#799's deploy date ${liveFrom} is later than ${earliestLive}, the earliest day already counted live: the backfill would overwrite live counts. Check --live-from (SELECT min(day) FROM consumption_day)`,
        );
      }
      await client.query(`INSERT INTO consumption_backfill (live_from) VALUES ($1::date)`, [liveFrom]);
    }
    // Only what an earlier run wrote is there: before `liveFrom`, nothing was counted live.
    await client.query(`DELETE FROM consumption_day WHERE day >= $1::date AND day < $2::date`, [from, liveFrom]);
    const { rowCount } = await client.query(
      `WITH stored AS (
         SELECT candidate_id, tool, (at AT TIME ZONE 'Europe/Paris')::date AS day, count(*)::integer AS count
           FROM (${STORED_USES}) AS uses
          WHERE (at AT TIME ZONE 'Europe/Paris')::date >= $1::date AND (at AT TIME ZONE 'Europe/Paris')::date < $2::date
          GROUP BY 1, 2, 3
       ),
       -- The weeks of a weekly Plan Quota wholly in the range (a week begun before it, or ending on or after \`liveFrom\`,
       -- says nothing of its days in it): its uses beyond those its stored results show.
       unshown AS (
         SELECT q.candidate_id, quota.tool, q.week::date AS day, q.used - COALESCE(sum(s.count), 0)::integer AS count
           FROM quota_usage q
           JOIN jsonb_each_text($3::jsonb) AS quota (key, tool) ON quota.key = q.quota
           LEFT JOIN stored s ON s.candidate_id = q.candidate_id AND s.tool = quota.tool AND s.day >= q.week::date AND s.day < q.week::date + 7
          WHERE q.week ~ '^\\d{4}-\\d{2}-\\d{2}$' AND q.week::date >= $1::date AND q.week::date + 7 <= $2::date
          GROUP BY q.candidate_id, quota.tool, q.week, q.used
       )
       INSERT INTO consumption_day (candidate_id, day, tool, count)
       SELECT candidate_id, day, tool, sum(count) FROM (SELECT * FROM stored UNION ALL SELECT * FROM unshown WHERE count > 0) AS uses
        GROUP BY candidate_id, day, tool`,
      [from, liveFrom, JSON.stringify(QUOTA_CONSUMPTION_TOOLS)],
    );
    const { rows: written } = await client.query<{ tool: ConsumptionTool; uses: number }>(
      `SELECT tool, sum(count)::integer AS uses FROM consumption_day WHERE day >= $1::date AND day < $2::date GROUP BY tool`,
      [from, liveFrom],
    );
    const uses = Object.fromEntries(consumptionTools().map((tool) => [tool, written.find((row) => row.tool === tool)?.uses ?? 0])) as Record<ConsumptionTool, number>;
    return { from, until: liveFrom, rows: rowCount ?? 0, uses };
  });
}
